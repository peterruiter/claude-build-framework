namespace App.Tests;

using System.Runtime.CompilerServices;

/// <summary>Where the repository and its contracts are, for tests that read files.</summary>
/// <remarks>
/// <para>
/// Prefer files copied beside the tests (<see cref="Contract"/>: the project file copies
/// build/contracts/*.json into the output), because they are found however the tests were built.
/// </para>
/// <para>
/// Some checks need the repository itself (every migration file, the web sources). <see cref="Root"/> walks
/// up from the build output to the solution file, and falls back to walking up from this source file. The
/// first walk fails when the build used --artifacts-path (the output is no longer under the repository),
/// which is why the release flow builds with a scratch artifacts path but runs the tests without one.
/// </para>
/// </remarks>
public static class Repository
{
    /// <summary>The repository root: the folder holding the .slnx.</summary>
    /// <param name="source">This file's path, filled in by the compiler.</param>
    public static string Root([CallerFilePath] string source = "")
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Path.GetDirectoryName(source) })
        {
            var folder = start;
            while (folder is not null && Directory.GetFiles(folder, "*.slnx").Length == 0) folder = Path.GetDirectoryName(folder);
            if (folder is not null) return folder;
        }

        throw new InvalidOperationException("The repository is not above the tests or above their source. Run the tests from a clone.");
    }

    /// <summary>A contract file's text, from beside the tests.</summary>
    /// <param name="name">The name without .json, such as locales.</param>
    public static string Contract(string name)
    {
        var copied = Path.Combine(AppContext.BaseDirectory, "Contracts", $"{name}.json");
        return File.ReadAllText(File.Exists(copied) ? copied : Path.Combine(Root(), "build", "contracts", $"{name}.json"));
    }
}
