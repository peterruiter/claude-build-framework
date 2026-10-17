using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Contoso.Sample.Plugins.Contacts
{
    /// <summary>
    /// PostOperation, asynchronous: contact Create. When a new contact belongs to an account that has no
    /// primary contact yet, it becomes that account's primary contact.
    ///
    /// Asynchronous because nobody waits for it: it runs after the transaction, through the system job
    /// queue, so it does not slow the save and its failure does not undo the contact. The queue can retry
    /// a job, so the work is idempotent: it reads first, writes only when the account still has no primary
    /// contact, and sends only the column it changes (unchanged columns still fire other plug-ins, flows
    /// and auditing).
    ///
    /// No Depth guard: the write cannot trigger this step again (it is an account Update, the step is on
    /// contact Create). Prefer that kind of reasoning, filtering attributes and comparing values over
    /// Depth checks, which also stop legitimate chains.
    /// </summary>
    public sealed class SetAccountPrimaryContact : PluginBase
    {
        public SetAccountPrimaryContact(string? unsecureConfiguration, string? secureConfiguration)
            : base(unsecureConfiguration, secureConfiguration)
        {
        }

        protected override void ExecuteDataversePlugin(ILocalPluginContext context)
        {
            var contact = context.Target;
            var parent = contact?.GetAttributeValue<EntityReference>("parentcustomerid");
            if (contact is null || parent is null || parent.LogicalName != "account")
            {
                context.Trace("No parent account: nothing to do.");
                return;
            }

            // Only the column the logic needs; never all columns.
            var account = context.UserService.Retrieve("account", parent.Id, new ColumnSet("primarycontactid"));
            if (account.GetAttributeValue<EntityReference>("primarycontactid") != null)
            {
                context.Trace("Account " + parent.Id + " already has a primary contact.");
                return;
            }

            context.UserService.Update(new Entity("account", parent.Id)
            {
                ["primarycontactid"] = new EntityReference("contact", contact.Id),
            });
            context.Trace("Account " + parent.Id + ": primary contact set to " + contact.Id + ".");
        }
    }
}
