using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Contoso.Sample.Plugins.Tests.Fakes
{
    /// <summary>Collects trace lines, formatted the way the platform formats them.</summary>
    public sealed class FakeTracingService : ITracingService
    {
        public List<string> Lines { get; } = new();

        public void Trace(string format, params object[] args) =>
            Lines.Add(args is null || args.Length == 0 ? format : string.Format(CultureInfo.InvariantCulture, format, args));

        public string All => string.Join("\n", Lines);
    }

    /// <summary>One call a plug-in made to the organization service.</summary>
    public sealed class ServiceCall
    {
        public ServiceCall(string operation, string table, Guid id, IReadOnlyList<string> columns)
        {
            Operation = operation;
            Table = table;
            Id = id;
            Columns = columns;
        }

        public string Operation { get; }
        public string Table { get; }
        public Guid Id { get; }
        public IReadOnlyList<string> Columns { get; }
    }

    /// <summary>
    /// An in-memory organization service, deliberately strict where Dataverse best practice is:
    /// it refuses all-columns retrieves and queries (name the columns), and records every call so tests
    /// can say "only this column was written".
    /// </summary>
    public sealed class FakeOrganizationService : IOrganizationService
    {
        private readonly Dictionary<(string Table, Guid Id), Entity> rows = new();

        public List<ServiceCall> Calls { get; } = new();

        /// <summary>When set, every call throws it (to test error handling).</summary>
        public Exception? FailWith { get; set; }

        public Entity Seed(Entity entity)
        {
            if (entity.Id == Guid.Empty) entity.Id = Guid.NewGuid();
            rows[(entity.LogicalName, entity.Id)] = Copy(entity, null);
            return entity;
        }

        public Entity? Stored(string table, Guid id) => rows.TryGetValue((table, id), out var row) ? Copy(row, null) : null;

        public Guid Create(Entity entity)
        {
            Fail();
            if (entity.Id == Guid.Empty) entity.Id = Guid.NewGuid();
            Calls.Add(new ServiceCall("Create", entity.LogicalName, entity.Id, entity.Attributes.Keys.ToList()));
            rows[(entity.LogicalName, entity.Id)] = Copy(entity, null);
            return entity.Id;
        }

        public Entity Retrieve(string entityName, Guid id, ColumnSet columnSet)
        {
            Fail();
            RequireColumns(columnSet, entityName);
            Calls.Add(new ServiceCall("Retrieve", entityName, id, columnSet.Columns.ToList()));
            if (!rows.TryGetValue((entityName, id), out var row)) throw NotFound(entityName, id);
            return Copy(row, columnSet);
        }

        public void Update(Entity entity)
        {
            Fail();
            Calls.Add(new ServiceCall("Update", entity.LogicalName, entity.Id, entity.Attributes.Keys.ToList()));
            if (!rows.TryGetValue((entity.LogicalName, entity.Id), out var row)) throw NotFound(entity.LogicalName, entity.Id);
            foreach (var attribute in entity.Attributes) row[attribute.Key] = attribute.Value;
        }

        public void Delete(string entityName, Guid id)
        {
            Fail();
            Calls.Add(new ServiceCall("Delete", entityName, id, Array.Empty<string>()));
            if (!rows.Remove((entityName, id))) throw NotFound(entityName, id);
        }

        public EntityCollection RetrieveMultiple(QueryBase query)
        {
            Fail();
            if (query is not QueryExpression expression) throw new NotSupportedException("The fake answers QueryExpression only.");
            RequireColumns(expression.ColumnSet, expression.EntityName);
            Calls.Add(new ServiceCall("RetrieveMultiple", expression.EntityName, Guid.Empty, expression.ColumnSet.Columns.ToList()));
            var matches = rows.Values
                .Where(row => row.LogicalName == expression.EntityName)
                .Where(row => expression.Criteria.Conditions.All(condition => Matches(row, condition)))
                .Select(row => Copy(row, expression.ColumnSet));
            if (expression.TopCount is int top) matches = matches.Take(top);
            return new EntityCollection(matches.ToList()) { EntityName = expression.EntityName };
        }

        public OrganizationResponse Execute(OrganizationRequest request) =>
            throw new NotSupportedException($"The fake does not execute {request?.RequestName}.");

        public void Associate(string entityName, Guid entityId, Relationship relationship, EntityReferenceCollection relatedEntities) =>
            throw new NotSupportedException();

        public void Disassociate(string entityName, Guid entityId, Relationship relationship, EntityReferenceCollection relatedEntities) =>
            throw new NotSupportedException();

        private void Fail()
        {
            if (FailWith != null) throw FailWith;
        }

        private static void RequireColumns(ColumnSet? columns, string table)
        {
            if (columns is null || columns.AllColumns || columns.Columns.Count == 0)
            {
                throw new InvalidOperationException($"Retrieve of {table} without named columns: name only the columns the logic needs.");
            }
        }

        private static bool Matches(Entity row, ConditionExpression condition)
        {
            if (condition.Operator != ConditionOperator.Equal) throw new NotSupportedException("The fake supports Equal conditions only.");
            row.Attributes.TryGetValue(condition.AttributeName, out var value);
            if (value is EntityReference reference) value = reference.Id;
            if (row.Id != Guid.Empty && condition.AttributeName == row.LogicalName + "id") value = row.Id;
            return Equals(value, condition.Values.Single());
        }

        private static Entity Copy(Entity source, ColumnSet? columns)
        {
            var copy = new Entity(source.LogicalName, source.Id);
            foreach (var attribute in source.Attributes)
            {
                if (columns is null || columns.Columns.Contains(attribute.Key)) copy[attribute.Key] = attribute.Value;
            }
            return copy;
        }

        private static Exception NotFound(string table, Guid id) =>
            new InvalidOperationException($"{table} {id} does not exist.");
    }

    /// <summary>Hands out the same fake service for every user (tests that care about the user check the context).</summary>
    public sealed class FakeOrganizationServiceFactory : IOrganizationServiceFactory
    {
        private readonly IOrganizationService service;

        public FakeOrganizationServiceFactory(IOrganizationService service) => this.service = service;

        public List<Guid?> UsersAskedFor { get; } = new();

        public IOrganizationService CreateOrganizationService(Guid? userId)
        {
            UsersAskedFor.Add(userId);
            return service;
        }
    }

    public sealed class FakeServiceProvider : IServiceProvider
    {
        private readonly Dictionary<Type, object> services = new();

        public FakeServiceProvider Add<T>(T service)
            where T : class
        {
            services[typeof(T)] = service;
            return this;
        }

        public object? GetService(Type serviceType) => services.TryGetValue(serviceType, out var service) ? service : null;
    }
}
