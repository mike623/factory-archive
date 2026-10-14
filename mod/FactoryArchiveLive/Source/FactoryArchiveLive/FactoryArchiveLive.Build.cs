using UnrealBuildTool;

public class FactoryArchiveLive : ModuleRules
{
	public FactoryArchiveLive(ReadOnlyTargetRules Target) : base(Target)
	{
		CppStandard = CppStandardVersion.Cpp20;
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		bLegacyPublicIncludePaths = false;

		PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "FactoryGame", "SML" });
		PrivateDependencyModuleNames.AddRange(new[] { "DummyHeaders" });
	}
}
