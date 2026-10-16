#include "FALiveSubsystem.h"

#include "Engine/World.h"
#include "FGBlueprintSubsystem.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/MemoryReader.h"
#include "TimerManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogFactoryArchiveLive, Log, All);

namespace
{
	constexpr float PollSeconds = 2.f;
	// Gives the game time to load the save's own blueprints before we look for new ones.
	constexpr float FirstPollDelaySeconds = 10.f;
	// Same caps SBS uses; anything bigger isn't a real blueprint.
	constexpr int64 MaxBlueprintBytes = 64 * 1024 * 1024;
	constexpr int64 MaxConfigBytes = 1024 * 1024;

	/** Read by Factory Archive (blueprints::mod_status) to show that the mod is running. Keep the name and fields in sync. */
	constexpr const TCHAR* StatusFile = TEXT("FactoryArchiveLive.json");

	FString PluginVersion()
	{
		const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("FactoryArchiveLive"));
		return Plugin ? Plugin->GetDescriptor().VersionName : TEXT("unknown");
	}

	/** Rewrites <blueprints>/FactoryArchiveLive.json; the app treats a fresh timestamp as "running". */
	void WriteStatus(const FString& SessionDirectory, int64 Loaded)
	{
		FString Directory = SessionDirectory;
		FPaths::NormalizeDirectoryName(Directory);
		const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetStringField(TEXT("version"), PluginVersion());
		Json->SetStringField(TEXT("session"), FPaths::GetCleanFilename(Directory));
		Json->SetNumberField(TEXT("loaded"), Loaded);
		FString Text;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text);
		FJsonSerializer::Serialize(Json, Writer);
		FFileHelper::SaveStringToFile(Text, *FPaths::Combine(FPaths::GetPath(Directory), StatusFile),
									  FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}

	/** Sizes and timestamps of the pair. Changes while Factory Archive is still writing (.sbp first, then .sbpcfg). */
	FString Signature(const FString& Sbp, const FString& Cfg)
	{
		IFileManager& Files = IFileManager::Get();
		return FString::Printf(TEXT("%lld/%lld/%lld/%lld"), Files.FileSize(*Sbp), Files.GetTimeStamp(*Sbp).GetTicks(),
							   Files.FileSize(*Cfg), Files.GetTimeStamp(*Cfg).GetTicks());
	}

	/** Parses the header (and config, if present) with the game's own serializers before handing the file to the game. */
	bool LooksValid(const FString& Sbp, const FString& Cfg)
	{
		IFileManager& Files = IFileManager::Get();
		const int64 SbpSize = Files.FileSize(*Sbp);
		TArray<uint8> Bytes;
		if (SbpSize < 20 || SbpSize > MaxBlueprintBytes || !FFileHelper::LoadFileToArray(Bytes, *Sbp))
		{
			return false;
		}
		FMemoryReader HeaderReader(Bytes);
		HeaderReader.ArMaxSerializeSize = MaxBlueprintBytes;
		FBlueprintHeader Header;
		if (!AFGBlueprintSubsystem::SerializeBlueprintHeader(HeaderReader, Header) || HeaderReader.IsError())
		{
			return false;
		}

		const int64 CfgSize = Files.FileSize(*Cfg);
		if (CfgSize < 0)
		{
			return true; // .sbpcfg is optional
		}
		if (CfgSize < 20 || CfgSize > MaxConfigBytes || !FFileHelper::LoadFileToArray(Bytes, *Cfg))
		{
			return false;
		}
		FMemoryReader ConfigReader(Bytes);
		ConfigReader.ArMaxSerializeSize = MaxConfigBytes;
		FBlueprintRecord Record;
		return AFGBlueprintSubsystem::SerializeBlueprintConfig(ConfigReader, Record) && !ConfigReader.IsError();
	}
}

bool UFALiveSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void UFALiveSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	// Clients don't own blueprints; they receive them from the host through replication.
	if (InWorld.GetNetMode() == NM_Client)
	{
		return;
	}
	UE_LOG(LogFactoryArchiveLive, Display, TEXT("Factory Archive Live %s watching for new blueprints"), *PluginVersion());
	InWorld.GetTimerManager().SetTimer(mPollTimer, this, &UFALiveSubsystem::Poll, PollSeconds, true,
									   FirstPollDelaySeconds);
}

void UFALiveSubsystem::Deinitialize()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(mPollTimer);
	}
	Super::Deinitialize();
}

void UFALiveSubsystem::Poll()
{
	// ponytail: polls a small folder every 2 s; switch to IDirectoryWatcher only if it proves available in shipping builds.
	AFGBlueprintSubsystem* Blueprints = AFGBlueprintSubsystem::Get(GetWorld());
	if (!IsValid(Blueprints))
	{
		return; // main menu, or the world isn't ready yet
	}
	const FString Directory = Blueprints->GetSessionBlueprintPath();
	if (Directory.IsEmpty())
	{
		return;
	}

	if (!IFileManager::Get().DirectoryExists(*Directory))
	{
		return; // never treat an unreadable or missing folder as "every blueprint was deleted"
	}
	TArray<FString> Found;
	IFileManager::Get().FindFiles(Found, *FPaths::Combine(Directory, TEXT("*.sbp")), true, false);

	TMap<FString, FString> StillPending;
	TArray<FString> Loaded;
	for (const FString& File : Found)
	{
		const FString Name = FPaths::GetBaseFilename(File);
		if (IsValid(Blueprints->GetBlueprintDescriptorByNameString(Name)))
		{
			continue; // the game already has it
		}
		const FString Sbp = FPaths::Combine(Directory, Name + TEXT(".sbp"));
		const FString Cfg = FPaths::Combine(Directory, Name + TEXT(".sbpcfg"));
		const FString Sig = Signature(Sbp, Cfg);

		// Load only once the files stopped changing between two polls, so we never read a half-written file.
		const FString* Previous = mPending.Find(Name);
		if (!Previous || *Previous != Sig)
		{
			StillPending.Add(Name, Sig);
			continue;
		}
		const FString* FailedSig = mFailed.Find(Name);
		if (FailedSig && *FailedSig == Sig)
		{
			StillPending.Add(Name, Sig);
			continue;
		}
		if (!LooksValid(Sbp, Cfg) || !Blueprints->ReadBlueprintFromDisc(Name))
		{
			UE_LOG(LogFactoryArchiveLive, Warning, TEXT("Couldn't load blueprint '%s'; will retry if the file changes"),
				   *Name);
			mFailed.Add(Name, Sig);
			StillPending.Add(Name, Sig);
			continue;
		}
		mFailed.Remove(Name);
		Loaded.Add(Name);
	}
	mPending = MoveTemp(StillPending);
	mLoadedCount += Loaded.Num();

	// Blueprints whose .sbp is gone (Factory Archive deleted or renamed it). "On disk" is the game's own descriptor for
	// each file name, so names the game sanitises for the file system still match.
	TSet<UFGBlueprintDescriptor*> OnDisk;
	bool bAllMatched = true;
	for (const FString& File : Found)
	{
		if (UFGBlueprintDescriptor* Desc = Blueprints->GetBlueprintDescriptorByNameString(FPaths::GetBaseFilename(File)))
		{
			OnDisk.Add(Desc);
		}
		else
		{
			bAllMatched = false;
		}
	}
	// The game's delete also deletes the blueprint's file. Only remove anything while every file maps to a loaded
	// blueprint: an unmatched file (still being written, failed to load, or named in a way we can't map) means we
	// can't be sure a "missing" blueprint isn't that file.
	if (!bAllMatched)
	{
		mMissing.Reset();
	}
	TArray<UFGBlueprintDescriptor*> All;
	if (bAllMatched)
	{
		Blueprints->GetBlueprintDescriptors_Internal(All);
	}
	TSet<FString> StillMissing;
	TArray<FString> Removed;
	for (UFGBlueprintDescriptor* Desc : All)
	{
		if (!IsValid(Desc) || OnDisk.Contains(Desc))
		{
			continue;
		}
		const FString Name = Desc->GetItemNameFromInstance().ToString();
		// Wait one more poll, so a file that is briefly missing (a rename, a slow disk) doesn't cost the blueprint.
		if (!mMissing.Contains(Name) || mRemoveFailed.Contains(Name))
		{
			StillMissing.Add(Name);
			continue;
		}
		// The game's own delete: drops the descriptor, tells clients, and deletes the file (already gone here).
		Blueprints->DeleteBlueprintDescriptor(Desc);
		TArray<UFGBlueprintDescriptor*> After;
		Blueprints->GetBlueprintDescriptors_Internal(After);
		if (After.Contains(Desc))
		{
			UE_LOG(LogFactoryArchiveLive, Warning, TEXT("Couldn't remove blueprint '%s'; reload the save to drop it"), *Name);
			mRemoveFailed.Add(Name);
			StillMissing.Add(Name);
			continue;
		}
		Removed.Add(Name);
	}
	if (bAllMatched)
	{
		mMissing = MoveTemp(StillMissing);
	}
	// ponytail: rewritten every poll (a few bytes every 2 s); the app reads the file's age, not a clock in it.
	WriteStatus(Directory, mLoadedCount);

	for (const FString& Name : Removed)
	{
		UE_LOG(LogFactoryArchiveLive, Display, TEXT("Removed blueprint '%s' (its file was deleted)"), *Name);
	}
	if (Loaded.IsEmpty() && Removed.IsEmpty())
	{
		return;
	}
	// Same sequence SBS uses after ReadBlueprintFromDisc: rebuild descriptors (build menu),
	// mark the category records for saving, and regenerate the manifest.
	Blueprints->RefreshBlueprintsAndDescriptors();
	Blueprints->MarkRecordDataDirty();
	Blueprints->GenerateManifest();
	for (const FString& Name : Loaded)
	{
		const bool bOk = IsValid(Blueprints->GetBlueprintDescriptorByNameString(Name));
		UE_LOG(LogFactoryArchiveLive, Display, TEXT("Loaded blueprint '%s'%s"), *Name,
			   bOk ? TEXT("") : TEXT(" (no descriptor afterwards)"));
	}
}
