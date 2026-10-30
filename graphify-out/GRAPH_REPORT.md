# Graph Report - factory-archive  (2026-10-30)

## Corpus Check
- 73 files · ~149,562 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .css 2, .icns 1)

## Summary
- 1112 nodes · 2606 edges · 64 communities (54 shown, 10 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 101 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6da6a2b3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- savedit.rs
- share.rs
- resolve.rs
- icons.jsx
- blueprints.rs
- modinstall.rs
- detail.tsx
- modals.tsx
- sav.rs
- icons.tsx
- tauri.conf.json
- sbp.rs
- Factory Archive
- lib.rs
- components.tsx
- meta.rs
- platform.ts
- ImageSlot
- App.tsx
- library.tsx
- compilerOptions
- FALiveSubsystem.cpp
- diskLibrary.ts
- client.tsx
- web_call
- UFALiveSubsystem
- Library
- categoryEditor.tsx
- package.json
- components.jsx
- tweaks-panel.jsx
- react
- ShareState
- dependencies
- Factory Archive Live
- data.ts
- devDependencies
- data.jsx
- modals.jsx
- Issue tracker: GitHub
- scripts
- gameFolder.ts
- platform.test.mjs
- default.json
- Interactive Prototype Dashboard
- detail.jsx
- Domain Docs
- WriteStatus
- import_bytes
- Agent skills
- CODING AGENTS: READ THIS FIRST
- app.jsx
- library
- Factory Archive theme controls
- repository
- vite.config.ts
- resources/README.md
- triage-labels.md
- factory-archive

## God Nodes (most connected - your core abstractions)
1. `Library()` - 48 edges
2. `I()` - 45 edges
3. `I()` - 41 edges
4. `Btn()` - 29 edges
5. `BlueprintDetail()` - 27 edges
6. `react` - 23 edges
7. `ImportModal()` - 21 edges
8. `web_call()` - 20 edges
9. `ImageSlot` - 20 edges
10. `MetaStore` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Game facts the code relies on` --references--> `initializePlatform()`  [INFERRED]
  AGENTS.md → app/src/platform.ts
- `Layout` --references--> `web_call()`  [EXTRACTED]
  AGENTS.md → app/src-tauri/src/lib.rs
- `Layout` --references--> `hasHost()`  [INFERRED]
  AGENTS.md → app/src/platform.ts
- `Layout` --references--> `call()`  [INFERRED]
  AGENTS.md → app/src/platform.ts
- `How it works` --references--> `UFALiveSubsystem`  [INFERRED]
  mod/FactoryArchiveLive/README.md → mod/FactoryArchiveLive/Source/FactoryArchiveLive/Public/FALiveSubsystem.h

## Import Cycles
- None detected.

## Communities (64 total, 10 thin omitted)

### Community 0 - "savedit.rs"
Cohesion: 0.07
Nodes (63): save_accounts(), Account, account_id(), accounts(), add_i32(), CategoryView, clear_undefined(), compress() (+55 more)

### Community 1 - "share.rs"
Cohesion: 0.05
Nodes (42): agent(), base_url(), call(), CONNECT_TIMEOUT, discover(), fetch_file(), finds_and_talks_to_a_host(), FoundHost (+34 more)

### Community 2 - "resolve.rs"
Cohesion: 0.08
Nodes (44): attr(), candidates(), clean_name(), client(), decode_entities(), decode_if_escaped(), details_from_html(), detect_source() (+36 more)

### Community 3 - "icons.jsx"
Cohesion: 0.08
Nodes (45): TopBar(), I(), IcArrowLeft(), IcBolt(), IcCalendar(), IcCheck(), IcChevDown(), IcChevron() (+37 more)

### Community 4 - "blueprints.rs"
Cohesion: 0.10
Nodes (38): BlueprintFile, BpError, BadName, Duplicate, Exists, Io, NotFound, copy_between() (+30 more)

### Community 5 - "modinstall.rs"
Cohesion: 0.10
Nodes (30): bottles(), crossover_folders(), detects_only_real_game_data_across_bottles_and_profiles(), directories(), folder(), GameFolder, native(), probe_local_crossover() (+22 more)

### Community 6 - "detail.tsx"
Cohesion: 0.11
Nodes (35): BlueprintImage(), useBlueprintImage(), BlueprintConfig, BlueprintInfo, Breakdown, BreakdownSection(), ConfigSwatch(), Line (+27 more)

### Community 7 - "modals.tsx"
Cohesion: 0.12
Nodes (32): BlueprintCard(), BlueprintRow(), ItemProps, LibraryBody(), LIST_COLS, SortKey, ViewMode, Check() (+24 more)

### Community 8 - "sav.rs"
Cohesion: 0.15
Nodes (30): cat(), categories_in_body(), CategoryCache, finds_the_newest_save_of_a_session(), fstr(), game_state(), is_v2(), latest_save() (+22 more)

### Community 9 - "icons.tsx"
Cohesion: 0.13
Nodes (30): TopBar(), I(), IcBolt(), IcCalendar(), IcChevDown(), IcClock(), IcCube(), IcDimensions() (+22 more)

### Community 10 - "tauri.conf.json"
Cohesion: 0.06
Nodes (30): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+22 more)

### Community 11 - "sbp.rs"
Cohesion: 0.17
Nodes (18): BlueprintConfig, Breakdown, CHUNK_TAG, count_buildings(), damaged_files_are_reported_not_guessed(), display_name(), fstr(), Line (+10 more)

### Community 12 - "Factory Archive"
Cohesion: 0.07
Nodes (25): Commands, Commits, Conventions, Game facts the code relies on, Hard rules, Releasing, app/, Blueprint breakdown (+17 more)

### Community 13 - "lib.rs"
Cohesion: 0.12
Nodes (19): blocking(), bundled_mod(), discover_hosts(), game_folders(), game_installs(), host_download(), host_hello(), import_link() (+11 more)

### Community 14 - "components.tsx"
Cohesion: 0.18
Nodes (24): BTN_VARIANTS, BtnVariant, Dot(), FileItem(), FilePair(), HeaderGlyph(), IconBtn(), isoBuilding() (+16 more)

### Community 15 - "meta.rs"
Cohesion: 0.15
Nodes (6): BlueprintMeta, key(), MetaStore, now(), stores_details_and_pictures_by_content(), valid_key()

### Community 16 - "platform.ts"
Cohesion: 0.14
Nodes (23): appMode, canShare(), confirmAction(), downloadBlueprint(), installLiveMod(), isWeb, listSessions(), ModInstall (+15 more)

### Community 17 - "ImageSlot"
Cohesion: 0.17
Nodes (6): getSlot(), ImageSlot, load(), save(), setSlot(), toDataUrl()

### Community 18 - "App.tsx"
Cohesion: 0.10
Nodes (22): matches(), NAV_TITLES, PREVIEW_DISK, SORTERS, START_EMPTY, byName(), categoryCounts(), CategoryRail() (+14 more)

### Community 19 - "library.tsx"
Cohesion: 0.14
Nodes (22): Btn(), NoResults(), GameFolderState, IcRefresh(), ago(), CurrentSaveRow(), FilterRail(), footerBtn (+14 more)

### Community 20 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+10 more)

### Community 21 - "FALiveSubsystem.cpp"
Cohesion: 0.12
Nodes (3): PluginVersion(), UFALiveSubsystem::DoesSupportWorldType(), UFALiveSubsystem::OnWorldBeginPlay()

### Community 22 - "diskLibrary.ts"
Cohesion: 0.15
Nodes (11): DISK_DEMO, BlueprintMeta, DiskFile, DiskSession, SOURCE_IDS, toBlueprint(), useDiskLibrary(), Phase (+3 more)

### Community 23 - "client.tsx"
Cohesion: 0.24
Nodes (16): addr(), AddressForm(), ClientGate(), ConnectCard(), Connection, ConnectScreen(), Ctx, errText() (+8 more)

### Community 24 - "web_call"
Cohesion: 0.14
Nodes (12): arg(), blueprint_image(), blueprint_info(), BlueprintInfo, category_tree(), check_category_edits(), delete_blueprint(), edit_categories() (+4 more)

### Community 25 - "UFALiveSubsystem"
Cohesion: 0.12
Nodes (7): UFALiveSubsystem, mFailed, mLoadedCount, mMissing, mPending, mPollTimer, mRemoveFailed

### Community 26 - "Library"
Cohesion: 0.26
Nodes (15): Layout, Library(), cache, clearImageCache(), load(), useCategoryEdits(), call(), categoryTree() (+7 more)

### Community 27 - "categoryEditor.tsx"
Cohesion: 0.19
Nodes (15): AccountCopy(), BatchMove(), CategoryEditor(), CategoryEditsState, categoryOf(), Editing, field, label() (+7 more)

### Community 28 - "package.json"
Cohesion: 0.13
Nodes (14): description, license, name, private, type, version, @fontsource/jetbrains-mono, @fontsource/space-grotesk (+6 more)

### Community 29 - "components.jsx"
Cohesion: 0.18
Nodes (7): isoBuilding(), isoSVG(), mulberry(), SourceBadge(), SourceMark(), Thumb(), thumbURI()

### Community 30 - "tweaks-panel.jsx"
Cohesion: 0.21
Nodes (8): TweakColor(), TweakRadio(), TweakRow(), TweakSelect(), TweakSlider(), TweakText(), __TwkCheck(), __twkIsLight()

### Community 31 - "react"
Cohesion: 0.20
Nodes (8): App(), read(), usePersistent(), initializePlatform(), readSaved(), Theme, useTheme(), react

### Community 32 - "ShareState"
Cohesion: 0.25
Nodes (6): link_imported(), share_set_session(), share_start(), share_status(), share_stop(), ShareState

### Community 33 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, @fontsource/jetbrains-mono, @fontsource/space-grotesk, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-dialog, @tauri-apps/plugin-opener (+2 more)

### Community 34 - "Factory Archive Live"
Cohesion: 0.20
Nodes (6): Building, CI and publishing, Factory Archive Live, How it works, Not verified yet, FactoryArchiveLive

### Community 35 - "data.ts"
Cohesion: 0.22
Nodes (8): ALL_TAGS, GAME_VERSIONS, NavId, powerTotal(), SAMPLE_LIBRARY, Source, STATUS, StatusId

### Community 36 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @tauri-apps/cli, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react

### Community 37 - "data.jsx"
Cohesion: 0.29
Nodes (6): ALL_TAGS, BP, CATEGORIES, NAV, SOURCES, STATUS

### Community 38 - "modals.jsx"
Cohesion: 0.43
Nodes (6): detectSource(), EXAMPLES, ExportDrawer(), ImportModal(), Meta(), pairs()

### Community 39 - "Issue tracker: GitHub"
Cohesion: 0.29
Nodes (6): Conventions, Issue tracker: GitHub, Pull requests as a triage surface, Wayfinding operations, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 40 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, tauri, typecheck

### Community 41 - "gameFolder.ts"
Cohesion: 0.53
Nodes (5): loadCustom(), useGameFolder(), findGameFolders(), GameFolder, pickGameFolder()

### Community 43 - "default.json"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 44 - "Interactive Prototype Dashboard"
Cohesion: 0.33
Nodes (5): Assistant, Assistant, Interactive Prototype Dashboard, User, User

### Community 45 - "detail.jsx"
Cohesion: 0.60
Nodes (5): Block(), BlueprintDetail(), DetailHeader(), FileRow(), Slot()

### Community 46 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 47 - "WriteStatus"
Cohesion: 0.47
Nodes (4): LooksValid(), Signature(), UFALiveSubsystem::Poll(), WriteStatus()

### Community 48 - "import_bytes"
Cohesion: 0.60
Nodes (4): copy_blueprints(), import_bytes(), import_files(), note_local()

### Community 49 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 50 - "CODING AGENTS: READ THIS FIRST"
Cohesion: 0.40
Nodes (4): About the design files, Bundle contents, CODING AGENTS: READ THIS FIRST, What you should do — IMPORTANT

### Community 51 - "app.jsx"
Cohesion: 0.60
Nodes (4): App(), LibraryBody(), TitleBar(), TWEAK_DEFAULTS

### Community 52 - "library"
Cohesion: 0.50
Nodes (3): LibFile, library(), LibSession

### Community 54 - "Factory Archive theme controls"
Cohesion: 0.50
Nodes (3): Assistant, Factory Archive theme controls, User

### Community 55 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **23 isolated node(s):** `@tauri-apps/cli`, `@types/react`, `@types/react-dom`, `factory-archive`, `BadName` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 321 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Layout` connect `Library` to `web_call`, `Factory Archive`?**
  _High betweenness centrality (0.293) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `@types/react`, `@types/react-dom` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `savedit.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.07157894736842105 - nodes in this community are weakly interconnected._
- **Why does `web_call()` connect `web_call` to `ShareState`, `lib.rs`, `import_bytes`, `library`, `Library`?**
  _High betweenness centrality (0.281) - this node is a cross-community bridge._
- **Should `share.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.05472837022132797 - nodes in this community are weakly interconnected._
- **Why does `hasHost()` connect `Library` to `detail.tsx`, `gameFolder.ts`, `platform.ts`, `App.tsx`, `diskLibrary.ts`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Should `resolve.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.08441558441558442 - nodes in this community are weakly interconnected._