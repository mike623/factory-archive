#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "FALiveSubsystem.generated.h"

/**
 * Watches the world's blueprint folder and loads blueprints that appear while the game is running,
 * so a save reload isn't needed. Only acts where blueprints live: the host or the dedicated server.
 *
 * A UWorldSubsystem is created by the engine for every world, so no SML GameWorldModule asset is needed.
 */
UCLASS()
class FACTORYARCHIVELIVE_API UFALiveSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Deinitialize() override;

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	void Poll();

	FTimerHandle mPollTimer;

	/** File signature (sizes + timestamps) per not-yet-loaded name, from the previous poll. */
	TMap<FString, FString> mPending;

	/** Signature of files that failed to load; retried only once the files change. */
	TMap<FString, FString> mFailed;
};
