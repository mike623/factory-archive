#include "FALiveSubsystem.h"

#include "Engine/World.h"
#include "FGBlueprintSubsystem.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
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

	if (Loaded.IsEmpty())
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
