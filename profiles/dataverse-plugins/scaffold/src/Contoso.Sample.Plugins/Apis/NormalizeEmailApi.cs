using Contoso.Sample.Plugins.Domain;

namespace Contoso.Sample.Plugins.Apis
{
    /// <summary>
    /// The main operation of the custom API contoso_NormalizeEmail (registration.json, customApis):
    /// an unbound action other code (a form script, a flow, an integration) calls to check an address the
    /// same way the validation plug-in does.
    ///
    ///   POST [org]/api/data/v9.2/contoso_NormalizeEmail   { "Email": " Ann@Example.COM " }
    ///   200 { "NormalizedEmail": "Ann@example.com", "IsValid": true }
    ///
    /// A custom API rather than a custom process action: it is defined as data (customapi rows in the
    /// solution), has typed parameters, needs no workflow designer and can be made private or limited by a
    /// privilege (executeprivilegename).
    /// </summary>
    public sealed class NormalizeEmailApi : PluginBase
    {
        public const string MessageName = "contoso_NormalizeEmail";

        public NormalizeEmailApi(string? unsecureConfiguration, string? secureConfiguration)
            : base(unsecureConfiguration, secureConfiguration)
        {
        }

        protected override void ExecuteDataversePlugin(ILocalPluginContext context)
        {
            var input = context.Input<string>("Email");
            if (string.IsNullOrWhiteSpace(input)) throw context.Refuse("api.email.required");

            var check = EmailAddress.Check(input, out var normalized);
            context.Output("NormalizedEmail", check == EmailCheck.Valid ? normalized : input!.Trim());
            context.Output("IsValid", check == EmailCheck.Valid);
        }
    }
}
