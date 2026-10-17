using System;
using Microsoft.Xrm.Sdk;

namespace Contoso.Sample.Plugins.Tests.Fakes
{
    /// <summary>
    /// Runs a plug-in the way the pipeline would for one step:
    ///
    ///   var run = new PluginRun("Create", "contact", PipelineStage.PreOperation).WithTarget(contact);
    ///   run.Execute(new ValidateContactEmail(null, null));
    /// </summary>
    public sealed class PluginRun
    {
        public const int English = 1033;
        public const int Dutch = 1043;

        public PluginRun(string message, string table, PipelineStage stage, bool asynchronous = false)
        {
            Context = new FakePluginExecutionContext
            {
                MessageName = message,
                PrimaryEntityName = table,
                Stage = (int)stage,
                Mode = asynchronous ? 1 : 0,
                IsInTransaction = !asynchronous,
            };
            Context.InitiatingUserId = Context.UserId;
            Factory = new FakeOrganizationServiceFactory(Service);
            Provider = new FakeServiceProvider()
                .Add<IPluginExecutionContext>(Context)
                .Add<ITracingService>(Tracing)
                .Add<IOrganizationServiceFactory>(Factory);
            InLanguage(English);
        }

        public FakePluginExecutionContext Context { get; }
        public FakeOrganizationService Service { get; } = new();
        public FakeOrganizationServiceFactory Factory { get; }
        public FakeTracingService Tracing { get; } = new();
        public FakeServiceProvider Provider { get; }

        public PluginRun WithTarget(Entity target)
        {
            if (target.Id == Guid.Empty) target.Id = Guid.NewGuid();
            Context.InputParameters["Target"] = target;
            Context.PrimaryEntityId = target.Id;
            return this;
        }

        public PluginRun WithInput(string name, object? value)
        {
            Context.InputParameters[name] = value;
            return this;
        }

        public PluginRun WithPreImage(string name, Entity image)
        {
            Context.PreEntityImages[name] = image;
            return this;
        }

        /// <summary>The initiating user's personal UI language (usersettings.uilanguageid).</summary>
        public PluginRun InLanguage(int lcid)
        {
            Service.Seed(new Entity("usersettings", Context.InitiatingUserId) { ["systemuserid"] = Context.InitiatingUserId, ["uilanguageid"] = lcid });
            return this;
        }

        public void Execute(IPlugin plugin)
        {
            Service.Calls.Clear();
            plugin.Execute(Provider);
        }
    }
}
