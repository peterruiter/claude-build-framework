using System;
using System.Linq;

namespace Contoso.Sample.Plugins.Domain
{
    /// <summary>The outcome of checking an email address.</summary>
    public enum EmailCheck
    {
        Valid,
        Invalid,
        TooLong,
    }

    /// <summary>
    /// Pure logic, no Dataverse types: the part worth most unit tests, shared by the validation plug-in
    /// and the custom API. A plain character check rather than a regular expression: predictable time on
    /// any input, which matters inside a synchronous plug-in.
    /// </summary>
    public static class EmailAddress
    {
        /// <summary>The length of contact.emailaddress1 in a default environment.</summary>
        public const int MaximumLength = 100;

        /// <summary>
        /// Checks an address and gives it back trimmed with the domain in lower case
        /// (" Ann@Example.COM " becomes "Ann@example.com"; the local part keeps its case).
        /// </summary>
        public static EmailCheck Check(string? input, out string normalized)
        {
            normalized = (input ?? string.Empty).Trim();
            if (normalized.Length > MaximumLength) return EmailCheck.TooLong;

            var at = normalized.IndexOf('@');
            if (at <= 0 || at != normalized.LastIndexOf('@') || at == normalized.Length - 1) return EmailCheck.Invalid;
            if (normalized.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c == ',' || c == ';' || c == '<' || c == '>')) return EmailCheck.Invalid;

            var local = normalized.Substring(0, at);
            var domain = normalized.Substring(at + 1).ToLowerInvariant();
            if (local.StartsWith(".", StringComparison.Ordinal) || local.EndsWith(".", StringComparison.Ordinal) || local.Contains("..")) return EmailCheck.Invalid;

            var labels = domain.Split('.');
            if (labels.Length < 2 || labels.Any(label => label.Length == 0 || label.StartsWith("-", StringComparison.Ordinal) || label.EndsWith("-", StringComparison.Ordinal))) return EmailCheck.Invalid;
            if (labels[labels.Length - 1].Length < 2) return EmailCheck.Invalid;

            normalized = local + "@" + domain;
            return EmailCheck.Valid;
        }
    }
}
