# Bundled resources

`release.yml` puts the Live mod here as `FactoryArchiveLive.zip` (from the newest `mod-v*` release, without debug symbols) before building. Local and CI dev builds ship without it; the app then asks for the zip instead.
