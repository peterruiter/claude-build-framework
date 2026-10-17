using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Xunit;

namespace Contoso.Sample.Plugins.Tests
{
    /// <summary>
    /// The registration manifest (build/contracts/registration.json) is a contract: it must match the
    /// assembly, and it must pass what the solution checker would flag for plug-in registrations
    /// (meta-remove-dup-reg, meta-avoid-reg-no-attribute, meta-avoid-reg-retrieve,
    /// meta-avoid-retrievemultiple-annotation) before anything reaches an environment.
    /// </summary>
    public class RegistrationManifestTests
    {
        private static readonly string[] Stages = { "PreValidation", "PreOperation", "PostOperation" };
        private static readonly string[] Modes = { "Synchronous", "Asynchronous" };
        private static readonly string[] ImageMessages = { "Assign", "Create", "Delete", "DeliverIncoming", "DeliverPromote", "Merge", "Route", "Send", "SetState", "Update" };
        private static readonly string[] ParameterTypes = { "Boolean", "DateTime", "Decimal", "Entity", "EntityCollection", "EntityReference", "Float", "Integer", "Money", "Picklist", "String", "StringArray", "Guid" };
        private static readonly Regex SecretLike = new("(password|passwd|secret|token|apikey|api-key|connectionstring|client_secret|sharedaccesskey)", RegexOptions.IgnoreCase);

        private static readonly Lazy<JsonDocument> Document = new(() =>
            JsonDocument.Parse(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Contracts", "registration.json"))));

        private static JsonElement Root => Document.Value.RootElement;
        private static string Prefix => Root.GetProperty("solution").GetProperty("publisherPrefix").GetString()!;
        private static IEnumerable<JsonElement> Steps => Root.GetProperty("steps").EnumerateArray();
        private static IEnumerable<JsonElement> Apis => Root.TryGetProperty("customApis", out var apis) ? apis.EnumerateArray() : Enumerable.Empty<JsonElement>();
        private static Assembly PluginAssembly => typeof(PluginBase).Assembly;

        private static string Text(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : string.Empty;

        private static string[] List(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
                ? value.EnumerateArray().Select(item => item.GetString()!).ToArray()
                : Array.Empty<string>();

        [Fact]
        public void The_solution_package_and_assembly_are_named_consistently()
        {
            Assert.Matches("^[a-z][a-z0-9]{1,7}$", Prefix);
            Assert.False(Prefix.StartsWith("mscrm", StringComparison.Ordinal), "mscrm is reserved");
            var package = Root.GetProperty("package");
            Assert.Equal(PluginAssembly.GetName().Name, Text(package, "assembly"));
            Assert.Equal(Prefix + "_" + Text(package, "assembly"), Text(package, "uniqueName"));
            Assert.Matches("^[A-Za-z][A-Za-z0-9]*$", Root.GetProperty("solution").GetProperty("uniqueName").GetString());
        }

        [Fact]
        public void Every_step_names_a_public_plugin_class_the_platform_can_construct()
        {
            foreach (var plugin in Steps.Select(step => Text(step, "plugin")).Concat(Apis.Select(api => Text(api, "plugin"))))
            {
                var type = PluginAssembly.GetType(plugin, throwOnError: false);
                Assert.True(type != null, $"{plugin} is not in {PluginAssembly.GetName().Name}");
                Assert.True(typeof(IPlugin).IsAssignableFrom(type) && type!.IsPublic && !type.IsAbstract, $"{plugin}: a public, concrete IPlugin");
                Assert.True(
                    type.GetConstructor(Type.EmptyTypes) != null || type.GetConstructor(new[] { typeof(string), typeof(string) }) != null,
                    $"{plugin}: needs a public constructor () or (string unsecure, string secure)");
            }
        }

        [Fact]
        public void Every_plugin_class_is_registered_somewhere()
        {
            var registered = new HashSet<string>(Steps.Select(step => Text(step, "plugin")).Concat(Apis.Select(api => Text(api, "plugin"))), StringComparer.Ordinal);
            var unregistered = PluginAssembly.GetTypes()
                .Where(type => typeof(IPlugin).IsAssignableFrom(type) && type.IsPublic && !type.IsAbstract)
                .Select(type => type.FullName!)
                .Where(name => !registered.Contains(name))
                .ToArray();
            Assert.True(unregistered.Length == 0, "Not in registration.json: " + string.Join(", ", unregistered));
        }

        [Fact]
        public void Steps_use_valid_stages_and_modes_and_async_only_after_the_operation()
        {
            foreach (var step in Steps)
            {
                var name = Text(step, "name");
                Assert.Contains(Text(step, "stage"), Stages);
                Assert.Contains(Text(step, "mode"), Modes);
                if (Text(step, "mode") == "Asynchronous") Assert.True(Text(step, "stage") == "PostOperation", $"{name}: asynchronous steps run PostOperation only");
                Assert.True(step.TryGetProperty("rank", out var rank) && rank.ValueKind == JsonValueKind.Number, $"{name}: set rank (execution order) explicitly");
                Assert.False(string.IsNullOrWhiteSpace(Text(step, "table")), $"{name}: a step names its table; 'none' only for messages without one");
                Assert.False(string.IsNullOrWhiteSpace(Text(step, "description")), $"{name}: a description says why the step exists");
            }
        }

        [Fact]
        public void No_duplicate_registrations_meta_remove_dup_reg()
        {
            var keys = Steps.Select(step => string.Join("|", Text(step, "plugin"), Text(step, "message"), Text(step, "table"), Text(step, "stage"), Text(step, "mode"))).ToArray();
            Assert.Equal(keys.Length, keys.Distinct(StringComparer.OrdinalIgnoreCase).Count());
            var names = Steps.Select(step => Text(step, "name")).ToArray();
            Assert.Equal(names.Length, names.Distinct(StringComparer.Ordinal).Count());
        }

        [Fact]
        public void Update_steps_have_filtering_attributes_without_the_primary_key_meta_avoid_reg_no_attribute()
        {
            foreach (var step in Steps.Where(step => Text(step, "message") == "Update"))
            {
                var attributes = List(step, "filteringAttributes");
                Assert.True(attributes.Length > 0, $"{Text(step, "name")}: an Update step lists filteringAttributes");
                Assert.DoesNotContain(Text(step, "table") + "id", attributes);
                Assert.All(attributes, attribute => Assert.Matches("^[a-z0-9_]+$", attribute));
            }
        }

        [Fact]
        public void No_retrieve_steps_without_a_written_reason_meta_avoid_reg_retrieve()
        {
            foreach (var step in Steps.Where(step => Text(step, "message") is "Retrieve" or "RetrieveMultiple"))
            {
                Assert.False(string.IsNullOrWhiteSpace(Text(step, "retrieveReason")), $"{Text(step, "name")}: Retrieve/RetrieveMultiple slows every read; give retrieveReason");
                Assert.False(Text(step, "message") == "RetrieveMultiple" && Text(step, "table") == "annotation", "Never on RetrieveMultiple of annotation");
            }
        }

        [Fact]
        public void Images_are_supported_named_and_list_their_columns()
        {
            foreach (var step in Steps)
            {
                if (!step.TryGetProperty("images", out var images)) continue;
                foreach (var image in images.EnumerateArray())
                {
                    var name = Text(step, "name");
                    Assert.Contains(Text(step, "message"), ImageMessages);
                    Assert.Matches("^[A-Za-z][A-Za-z0-9]*$", Text(image, "name"));
                    Assert.Contains(Text(image, "type"), new[] { "Pre", "Post" });
                    Assert.True(List(image, "attributes").Length > 0, $"{name}: an image lists its columns (never all columns)");
                    if (Text(image, "type") == "Pre") Assert.True(Text(step, "message") != "Create", $"{name}: no pre-image on Create");
                    if (Text(image, "type") == "Post")
                    {
                        Assert.True(Text(step, "stage") == "PostOperation", $"{name}: post-images exist only PostOperation");
                        Assert.True(Text(step, "message") != "Delete", $"{name}: no post-image on Delete");
                    }
                }
            }
        }

        [Fact]
        public void Unsecure_configuration_holds_no_secrets()
        {
            foreach (var step in Steps)
            {
                var configuration = Text(step, "unsecureConfiguration");
                Assert.False(SecretLike.IsMatch(configuration), $"{Text(step, "name")}: unsecure configuration is exported with the solution and readable; no secrets");
                Assert.False(step.TryGetProperty("secureConfiguration", out _), "Secure configuration is never in the repository; an administrator sets it per environment");
            }
        }

        [Fact]
        public void Custom_apis_are_prefixed_typed_and_bound_to_a_plugin()
        {
            foreach (var api in Apis)
            {
                var name = Text(api, "uniqueName");
                Assert.Matches("^" + Prefix + "_[A-Za-z][A-Za-z0-9]*$", name);
                Assert.Contains(Text(api, "bindingType"), new[] { "Global", "Entity", "EntityCollection" });
                Assert.Contains(Text(api, "allowedCustomProcessingStepType"), new[] { "None", "AsyncOnly", "SyncAndAsync" });
                var parameters = api.GetProperty("requestParameters").EnumerateArray().ToArray();
                var properties = api.GetProperty("responseProperties").EnumerateArray().ToArray();
                foreach (var item in parameters.Concat(properties))
                {
                    Assert.Matches("^[A-Za-z][A-Za-z0-9]*$", Text(item, "uniqueName"));
                    Assert.Contains(Text(item, "type"), ParameterTypes);
                }
                Assert.Equal(parameters.Length, parameters.Select(item => Text(item, "uniqueName")).Distinct().Count());
                Assert.Equal(properties.Length, properties.Select(item => Text(item, "uniqueName")).Distinct().Count());
                if (api.GetProperty("isFunction").GetBoolean()) Assert.True(properties.Length > 0, $"{name}: a function returns something");
            }
        }
    }
}
