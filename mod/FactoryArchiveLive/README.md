# Factory Archive Live

A small Satisfactory mod that loads blueprints Factory Archive adds to a world's blueprint folder **while the game is running**, so you don't have to reload the save.

It only works on the machine that owns the world's blueprints: the host, or the dedicated server. Other players receive new blueprints from the host as usual, and they don't need the mod (`RequiredOnRemote: false`).

## How it works

Every 2 seconds, `UFALiveSubsystem` lists the `.sbp` files in the current session's folder (`AFGBlueprintSubsystem::GetSessionBlueprintPath()`). A file is loaded when all of these are true:

1. The game has no blueprint with that name yet.
2. The `.sbp` and `.sbpcfg` sizes and timestamps were the same in two polls in a row, so the file is fully written.
3. Its header and config parse with the game's own serializers.

The subsystem then calls the game's own sequence, the same one [SBS](https://github.com/Satisfactory-KMods/public-source/tree/main/SBS) uses: `ReadBlueprintFromDisc`, `RefreshBlueprintsAndDescriptors`, `MarkRecordDataDirty` and `GenerateManifest`.

The mod never writes, renames or deletes blueprint files. Its only write is a status file, `<blueprints>/FactoryArchiveLive.json` (`version`, `session`, `loaded`), rewritten on every poll while a world is loaded. Factory Archive shows "Live mod running" in its sidebar while that file is less than 10 seconds old.

## Building

You need the [SML starter project](https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/project_setup.html) for the game version you target (1.2 / UE 5.6 CSS / SML 3.12 at the time of writing).

1. Copy or symlink this folder to `<starter project>/Mods/FactoryArchiveLive`.
2. Regenerate project files and build `FactoryEditor Win64 Development`.
3. Package it with Alpakit (Windows, WindowsServer, LinuxServer).

## CI and publishing

`.github/workflows/mod.yml` builds the mod on every push to `main` that touches `mod/`. Pushing a `mod-v<SemVersion>` tag also uploads it to ficsit.app as a beta, so players can install it with Satisfactory Mod Manager. Factory Archive releases also bundle the newest `mod-v*` release, so the app can install or update it in one click (SML must be installed). The tag must match `SemVersion` in the `.uplugin`.

It runs on a **self-hosted Windows runner**. GitHub's own runners are too small for the modding engine, and the engine's license doesn't allow putting it in a public image. One-time setup:

1. On the Windows machine, install the CSS engine, Visual Studio, Wwise and the SML starter project ([Dependencies](https://docs.ficsit.app/satisfactory-modding/latest/Development/BeginnersGuide/dependencies.html)). Build it once by hand to confirm it works.
2. Add a runner to this repo (Settings → Actions → Runners → New self-hosted runner) with the labels `self-hosted, windows, satisfactory-modding`.
3. Add these repository variables: `UE_ROOT` (the engine folder that contains `Engine/`) and `SML_PROJECT` (the folder that contains `FactoryGame.uproject`).
4. On [ficsit.app](https://ficsit.app), create the mod with mod reference **`FactoryArchiveLive`**. Add its ID as the variable `SMR_MOD_ID`, and the value of the `token` cookie from a signed-in ficsit.app session as the secret `SMR_API_KEY`.
5. In Settings → Actions → General, set fork pull request workflows to require approval. The workflow never runs on pull requests, but keep that setting anyway.

## Not verified yet

- The function signatures come from SBS's calls against game 1.2. Check them against `FGBlueprintSubsystem.h` in your starter project.
- Whether `ReadBlueprintFromDisc` accepts a blueprint without a `.sbpcfg`. The mod allows it, because the game itself saves pairs.
- Whether a deleted file gets removed from the build menu. The mod only adds blueprints. Removing one still needs a reload.
