using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Xunit;

namespace Contoso.Sample.Plugins.Tests
{
    /// <summary>
    /// Microsoft's plug-in best practices that a compiler does not check, checked on every build instead of
    /// once in an environment by the solution checker: stateless plug-ins, no parallel work, no batch
    /// requests, no all-columns reads, no file system, timeouts on outbound calls.
    /// </summary>
    public class CodeRulesTests
    {
        private static Assembly PluginAssembly => typeof(PluginBase).Assembly;

        private static string[] SourceFiles =>
            Directory.GetFiles(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Sources"), "*.cs", SearchOption.AllDirectories);

        [Fact]
        public void Plugins_keep_no_state_between_executions()
        {
            var plugins = PluginAssembly.GetTypes().Where(type => typeof(IPlugin).IsAssignableFrom(type));
            foreach (var type in plugins)
            {
                var mutable = type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                    .Where(field => !field.IsInitOnly)
                    .Select(field => field.Name)
                    .ToArray();
                Assert.True(mutable.Length == 0, $"{type.Name} has writable fields ({string.Join(", ", mutable)}): the platform reuses one instance on many threads");
            }
        }

        [Fact]
        public void Nothing_static_can_change()
        {
            var writable = PluginAssembly.GetTypes()
                .Where(type => !type.IsDefined(typeof(CompilerGeneratedAttribute), false))
                .SelectMany(type => type.GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                    .Where(field => !field.IsInitOnly && !field.IsLiteral && !field.IsDefined(typeof(CompilerGeneratedAttribute), false))
                    .Select(field => type.Name + "." + field.Name))
                .ToArray();
            Assert.True(writable.Length == 0, "Writable static fields: " + string.Join(", ", writable));
        }

        [Theory]
        [InlineData(@"\bParallel\.", "parallel execution is not supported in plug-ins")]
        [InlineData(@"\bTask\.(Run|Factory)\b", "no background threads: the sandbox may end the process when Execute returns")]
        [InlineData(@"new\s+Thread\s*\(|\bThreadPool\.", "no threads")]
        [InlineData(@"\bExecuteMultipleRequest\b|\bExecuteTransactionRequest\b", "no batch requests inside a plug-in")]
        [InlineData(@"new\s+ColumnSet\s*\(\s*true\s*\)|AllColumns\s*=\s*true", "name the columns; never all columns")]
        [InlineData(@"\bSystem\.IO\.(File|Directory)\b|\bFile\.(Read|Write|Open|Create|Exists)|\bDirectory\.", "no file system in the sandbox")]
        [InlineData(@"\bEnvironment\.GetEnvironmentVariable\b|\bRegistry\.", "no machine environment or registry in the sandbox")]
        [InlineData(@"\bConsole\.", "trace through ITracingService")]
        [InlineData(@"\bThread\.Sleep\b", "no sleeping in the pipeline")]
        public void Plugin_code_avoids(string pattern, string why)
        {
            var regex = new Regex(pattern);
            var hits = SourceFiles
                .SelectMany(file => File.ReadAllLines(file).Select((line, index) => (file, line, index)))
                .Where(hit => !hit.line.TrimStart().StartsWith("//", StringComparison.Ordinal) && !hit.line.TrimStart().StartsWith("///", StringComparison.Ordinal))
                .Where(hit => regex.IsMatch(hit.line))
                .Select(hit => $"{Path.GetFileName(hit.file)}:{hit.index + 1}")
                .ToArray();
            Assert.True(hits.Length == 0, $"{why}: {string.Join(", ", hits)}");
        }

        [Fact]
        public void Outbound_http_sets_a_timeout_and_no_keep_alive()
        {
            foreach (var file in SourceFiles)
            {
                var text = File.ReadAllText(file);
                if (!Regex.IsMatch(text, @"new\s+HttpClient\s*\(|new\s+WebClient\s*\(|WebRequest\.Create")) continue;
                Assert.True(text.Contains(".Timeout"), $"{Path.GetFileName(file)}: set a timeout well under the 2-minute limit");
                Assert.True(Regex.IsMatch(text, @"ConnectionClose\s*=\s*true|KeepAlive\s*=\s*false"), $"{Path.GetFileName(file)}: turn keep-alive off for calls from the sandbox");
            }
        }

        [Fact]
        public void The_sources_were_found()
        {
            Assert.Contains(SourceFiles, file => Path.GetFileName(file) == "PluginBase.cs");
        }
    }
}
