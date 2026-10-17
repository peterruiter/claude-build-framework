using System;
using System.Collections.Generic;
using System.Globalization;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.PluginTelemetry;
using Microsoft.Xrm.Sdk.Query;

namespace Contoso.Sample.Plugins
{
    /// <summary>The pipeline stage a step runs in (sdkmessageprocessingstep.stage).</summary>
    public enum PipelineStage
    {
        PreValidation = 10,
        PreOperation = 20,
        MainOperation = 30,
        PostOperation = 40,
    }

    /// <summary>
    /// What a plug-in needs from one execution, unwrapped once. A new instance per execution: never
    /// keep it, or anything it hands out, in a field.
    /// </summary>
    public interface ILocalPluginContext
    {
        IPluginExecutionContext ExecutionContext { get; }

        /// <summary>Runs as the step's user (the calling user unless the step impersonates). Use this by default.</summary>
        IOrganizationService UserService { get; }

        /// <summary>Runs as SYSTEM, past every security role. Only for reads the caller may not do but the logic needs.</summary>
        IOrganizationService SystemService { get; }

        ITracingService TracingService { get; }

        /// <summary>Application Insights logger; null when the environment does not export telemetry.</summary>
        ILogger? Logger { get; }

        string MessageName { get; }
        string PrimaryEntityName { get; }
        PipelineStage Stage { get; }
        bool IsAsynchronous { get; }
        int Depth { get; }
        Guid CorrelationId { get; }

        /// <summary>The record being created or updated (InputParameters["Target"] as Entity); null otherwise.</summary>
        Entity? Target { get; }

        /// <summary>The record the message is about: Target as a reference, or the deleted reference.</summary>
        EntityReference? TargetReference { get; }

        /// <summary>A pre-image registered under this name (manifest: images[].name), or null.</summary>
        Entity? PreImage(string imageName);

        /// <summary>A post-image registered under this name, or null.</summary>
        Entity? PostImage(string imageName);

        /// <summary>An input parameter (custom API request parameter) or the default when absent.</summary>
        T? Input<T>(string name);

        /// <summary>Sets an output parameter (custom API response property).</summary>
        void Output(string name, object? value);

        /// <summary>
        /// Writes a line to the plug-in trace log. Say what happened and why, never who: no names, email
        /// addresses, phone numbers or free text from records. Ids are fine.
        /// </summary>
        void Trace(string message);

        /// <summary>A message for the person who started the operation, in their own language.</summary>
        string Text(string key, IReadOnlyDictionary<string, string>? values = null);

        /// <summary>A refusal the person reads: build it here and throw it.</summary>
        InvalidPluginExecutionException Refuse(string key, IReadOnlyDictionary<string, string>? values = null);
    }

    /// <summary>The <see cref="ILocalPluginContext"/> the platform's service provider gives.</summary>
    public sealed class LocalPluginContext : ILocalPluginContext
    {
        private readonly IOrganizationServiceFactory factory;
        private IOrganizationService? userService;
        private IOrganizationService? systemService;
        private string? language;

        public LocalPluginContext(IServiceProvider serviceProvider)
        {
            if (serviceProvider is null) throw new ArgumentNullException(nameof(serviceProvider));
            ExecutionContext = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            TracingService = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            Logger = serviceProvider.GetService(typeof(ILogger)) as ILogger;
        }

        public IPluginExecutionContext ExecutionContext { get; }
        public ITracingService TracingService { get; }
        public ILogger? Logger { get; }

        public IOrganizationService UserService => userService ??= factory.CreateOrganizationService(ExecutionContext.UserId);
        public IOrganizationService SystemService => systemService ??= factory.CreateOrganizationService(null);

        public string MessageName => ExecutionContext.MessageName;
        public string PrimaryEntityName => ExecutionContext.PrimaryEntityName;
        public PipelineStage Stage => (PipelineStage)ExecutionContext.Stage;
        public bool IsAsynchronous => ExecutionContext.Mode == 1;
        public int Depth => ExecutionContext.Depth;
        public Guid CorrelationId => ExecutionContext.CorrelationId;

        public Entity? Target =>
            ExecutionContext.InputParameters.TryGetValue("Target", out var value) ? value as Entity : null;

        public EntityReference? TargetReference
        {
            get
            {
                if (!ExecutionContext.InputParameters.TryGetValue("Target", out var value)) return null;
                return value switch
                {
                    EntityReference reference => reference,
                    Entity entity => entity.ToEntityReference(),
                    _ => null,
                };
            }
        }

        public Entity? PreImage(string imageName) =>
            ExecutionContext.PreEntityImages.TryGetValue(imageName, out var image) ? image : null;

        public Entity? PostImage(string imageName) =>
            ExecutionContext.PostEntityImages.TryGetValue(imageName, out var image) ? image : null;

        public T? Input<T>(string name) =>
            ExecutionContext.InputParameters.TryGetValue(name, out var value) && value is T typed ? typed : default;

        public void Output(string name, object? value) => ExecutionContext.OutputParameters[name] = value;

        public void Trace(string message) => TracingService?.Trace("{0}", message);

        public string Text(string key, IReadOnlyDictionary<string, string>? values = null) =>
            Messages.Format(key, Language(), values);

        public InvalidPluginExecutionException Refuse(string key, IReadOnlyDictionary<string, string>? values = null) =>
            new InvalidPluginExecutionException(Text(key, values));

        /// <summary>
        /// The language of the person who started the operation (their personal UI language), read once
        /// and only when a message is needed. The source language when it cannot be read or is not offered.
        /// </summary>
        private string Language()
        {
            if (language != null) return language;
            try
            {
                var query = new QueryExpression("usersettings") { ColumnSet = new ColumnSet("uilanguageid"), TopCount = 1 };
                query.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, ExecutionContext.InitiatingUserId);
                var rows = SystemService.RetrieveMultiple(query).Entities;
                var lcid = rows.Count == 0 ? 0 : rows[0].GetAttributeValue<int?>("uilanguageid") ?? 0;
                language = Messages.LanguageFor(lcid);
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                Trace(string.Format(CultureInfo.InvariantCulture, "User language not readable ({0}); using the source language.", exception.GetType().Name));
                language = Messages.SourceLanguage;
            }
            return language;
        }
    }
}
