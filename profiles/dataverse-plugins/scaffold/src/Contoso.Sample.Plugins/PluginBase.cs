using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.ServiceModel;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.PluginTelemetry;

namespace Contoso.Sample.Plugins
{
    /// <summary>
    /// Every plug-in and custom API derives from this.
    ///
    /// It unwraps the service provider into an <see cref="ILocalPluginContext"/>, traces start and end
    /// (message, table, stage, mode, depth, correlation id: never record data), and makes sure the person
    /// who started the operation reads one sentence in their own language rather than a stack trace:
    ///
    ///   - <see cref="InvalidPluginExecutionException"/> passes through untouched; its message was written
    ///     for the user on purpose (<see cref="ILocalPluginContext.Refuse"/>).
    ///   - Anything else is traced (type and message), logged to Application Insights when the environment
    ///     exports telemetry, and replaced by the localised "error.unexpected" text with the correlation id,
    ///     so support can find the trace without the user reading internals.
    ///
    /// The platform caches plug-in instances and runs them on several threads at once. A derived class
    /// keeps no state: no fields except the step configuration passed to the constructor (read-only),
    /// nothing static that changes. The code-rule tests enforce it.
    /// </summary>
    public abstract class PluginBase : IPlugin
    {
        /// <param name="unsecureConfiguration">The step's unsecure configuration: plain settings, never secrets (exported with solutions, readable by customisers).</param>
        /// <param name="secureConfiguration">The step's secure configuration: readable by administrators only and NOT exported with solutions.</param>
        protected PluginBase(string? unsecureConfiguration = null, string? secureConfiguration = null)
        {
            UnsecureConfiguration = unsecureConfiguration;
            SecureConfiguration = secureConfiguration;
        }

        protected string? UnsecureConfiguration { get; }

        protected string? SecureConfiguration { get; }

        public void Execute(IServiceProvider serviceProvider)
        {
            if (serviceProvider is null) throw new InvalidPluginExecutionException(nameof(serviceProvider));

            var context = new LocalPluginContext(serviceProvider);
            var name = GetType().Name;
            var clock = Stopwatch.StartNew();
            context.Trace(string.Format(
                CultureInfo.InvariantCulture,
                "{0} {1}: {2} {3}, stage {4}, {5}, depth {6}, correlation {7}",
                name,
                typeof(PluginBase).Assembly.GetName().Version,
                context.MessageName,
                context.PrimaryEntityName,
                (int)context.Stage,
                context.IsAsynchronous ? "async" : "sync",
                context.Depth,
                context.CorrelationId));

            try
            {
                ExecuteDataversePlugin(context);
            }
            catch (InvalidPluginExecutionException)
            {
                context.Trace(name + ": refused (message for the user).");
                throw;
            }
            catch (FaultException<OrganizationServiceFault> fault)
            {
                // The fault's message can quote record values; trace the code and type, keep the message out.
                context.Trace(string.Format(CultureInfo.InvariantCulture, "{0}: Dataverse fault 0x{1:X8}.", name, fault.Detail?.ErrorCode ?? 0));
                context.Logger?.LogError(fault, "{0}: Dataverse fault", name);
                throw Unexpected(context);
            }
            catch (Exception exception) when (exception is not OutOfMemoryException and not StackOverflowException)
            {
                context.Trace(string.Format(CultureInfo.InvariantCulture, "{0}: {1} at {2}", name, exception.GetType().FullName, exception.TargetSite?.Name));
                context.Logger?.LogError(exception, "{0}: unexpected error", name);
                throw Unexpected(context);
            }
            finally
            {
                context.Trace(string.Format(CultureInfo.InvariantCulture, "{0}: done in {1} ms.", name, clock.ElapsedMilliseconds));
            }
        }

        /// <summary>The plug-in's work. Throw <see cref="ILocalPluginContext.Refuse"/> to stop the operation with a message.</summary>
        protected abstract void ExecuteDataversePlugin(ILocalPluginContext context);

        // No inner exception on purpose: its message can quote record data and would reach the error dialog.
        private static InvalidPluginExecutionException Unexpected(LocalPluginContext context) =>
            new InvalidPluginExecutionException(
                OperationStatus.Failed,
                context.Text("error.unexpected", new Dictionary<string, string> { ["correlationId"] = context.CorrelationId.ToString() }));
    }
}
