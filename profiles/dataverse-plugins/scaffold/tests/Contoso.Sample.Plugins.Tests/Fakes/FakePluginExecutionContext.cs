using System;
using Microsoft.Xrm.Sdk;

namespace Contoso.Sample.Plugins.Tests.Fakes
{
    /// <summary>A plain execution context: set what the step would get, leave the rest at defaults.</summary>
    public sealed class FakePluginExecutionContext : IPluginExecutionContext
    {
        public int Stage { get; set; } = (int)PipelineStage.PreOperation;
        public IPluginExecutionContext? ParentContext { get; set; }
        public int Mode { get; set; }
        public int IsolationMode { get; set; } = 2;
        public int Depth { get; set; } = 1;
        public string MessageName { get; set; } = "Create";
        public string PrimaryEntityName { get; set; } = "none";
        public Guid? RequestId { get; set; } = Guid.NewGuid();
        public string SecondaryEntityName { get; set; } = "none";
        public ParameterCollection InputParameters { get; } = new();
        public ParameterCollection OutputParameters { get; } = new();
        public ParameterCollection SharedVariables { get; } = new();
        public Guid UserId { get; set; } = Guid.NewGuid();
        public Guid InitiatingUserId { get; set; }
        public Guid BusinessUnitId { get; set; } = Guid.NewGuid();
        public Guid OrganizationId { get; set; } = Guid.NewGuid();
        public string OrganizationName { get; set; } = "test";
        public Guid PrimaryEntityId { get; set; }
        public EntityImageCollection PreEntityImages { get; } = new();
        public EntityImageCollection PostEntityImages { get; } = new();
        public EntityReference? OwningExtension { get; set; }
        public Guid CorrelationId { get; set; } = Guid.NewGuid();
        public bool IsExecutingOffline { get; set; }
        public bool IsOfflinePlayback { get; set; }
        public bool IsInTransaction { get; set; } = true;
        public Guid OperationId { get; set; } = Guid.NewGuid();
        public DateTime OperationCreatedOn { get; set; } = DateTime.UtcNow;
    }
}
