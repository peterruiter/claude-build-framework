using System.Collections.Generic;
using System.Globalization;
using Contoso.Sample.Plugins.Domain;
using Microsoft.Xrm.Sdk;

namespace Contoso.Sample.Plugins.Contacts
{
    /// <summary>
    /// Validation in PreOperation, synchronous: contact Create, and Update filtered on emailaddress1
    /// (build/contracts/registration.json).
    ///
    /// Refuses an invalid address with a message in the user's language, and stores a valid one tidied
    /// (trimmed, domain in lower case). Changing the Target in PreOperation is saved with the operation
    /// itself: no extra Update, no second pipeline run.
    ///
    /// PreValidation would refuse before the transaction starts, but it runs before security checks
    /// and outside the transaction only for the first call; PreOperation is the documented stage for
    /// changing the record being saved. Refusing here rolls the transaction back, which is fine for a
    /// rare, user-caused refusal.
    /// </summary>
    public sealed class ValidateContactEmail : PluginBase
    {
        public const string Column = "emailaddress1";

        public ValidateContactEmail(string? unsecureConfiguration, string? secureConfiguration)
            : base(unsecureConfiguration, secureConfiguration)
        {
        }

        protected override void ExecuteDataversePlugin(ILocalPluginContext context)
        {
            var target = context.Target;
            if (target is null || !target.Contains(Column)) return; // Update without the column: nothing to check

            var value = target.GetAttributeValue<string>(Column);
            if (string.IsNullOrWhiteSpace(value)) return; // clearing the address is allowed

            switch (EmailAddress.Check(value, out var normalized))
            {
                case EmailCheck.TooLong:
                    throw context.Refuse("contact.email.too-long", new Dictionary<string, string>
                    {
                        ["maximum"] = EmailAddress.MaximumLength.ToString(CultureInfo.InvariantCulture),
                    });
                case EmailCheck.Invalid:
                    context.Trace("Email address refused (format)."); // never the address itself
                    throw context.Refuse("contact.email.invalid");
                default:
                    if (normalized != value) target[Column] = normalized;
                    break;
            }
        }
    }
}
