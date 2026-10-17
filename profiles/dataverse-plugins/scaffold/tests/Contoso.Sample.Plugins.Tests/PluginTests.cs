using System;
using System.Collections.Generic;
using System.Linq;
using Contoso.Sample.Plugins.Apis;
using Contoso.Sample.Plugins.Contacts;
using Contoso.Sample.Plugins.Domain;
using Contoso.Sample.Plugins.Tests.Fakes;
using Microsoft.Xrm.Sdk;
using Xunit;

namespace Contoso.Sample.Plugins.Tests
{
    public class EmailAddressTests
    {
        [Theory]
        [InlineData("ann@example.com", "ann@example.com")]
        [InlineData("  Ann.Smith@Example.COM ", "Ann.Smith@example.com")]
        [InlineData("a+tag@sub.example.co.uk", "a+tag@sub.example.co.uk")]
        public void Accepts_and_tidies(string input, string expected)
        {
            Assert.Equal(EmailCheck.Valid, EmailAddress.Check(input, out var normalized));
            Assert.Equal(expected, normalized);
        }

        [Theory]
        [InlineData("")]
        [InlineData("ann")]
        [InlineData("@example.com")]
        [InlineData("ann@")]
        [InlineData("ann@@example.com")]
        [InlineData("ann@example")]
        [InlineData("ann@example.c")]
        [InlineData("ann smith@example.com")]
        [InlineData("ann..smith@example.com")]
        [InlineData("ann@-example.com")]
        [InlineData("ann@example..com")]
        [InlineData("ann@example.com;bob@example.com")]
        public void Refuses(string input) => Assert.Equal(EmailCheck.Invalid, EmailAddress.Check(input, out _));

        [Fact]
        public void Refuses_more_than_the_column_holds() =>
            Assert.Equal(EmailCheck.TooLong, EmailAddress.Check(new string('a', 95) + "@example.com", out _));
    }

    public class ValidateContactEmailTests
    {
        private static PluginRun Run(string message, Entity contact) =>
            new PluginRun(message, "contact", PipelineStage.PreOperation).WithTarget(contact);

        [Fact]
        public void A_valid_address_is_saved_tidied_without_an_extra_update()
        {
            var contact = new Entity("contact") { ["emailaddress1"] = " Ann@Example.COM " };
            var run = Run("Create", contact);

            run.Execute(new ValidateContactEmail(null, null));

            Assert.Equal("Ann@example.com", contact["emailaddress1"]);
            Assert.DoesNotContain(run.Service.Calls, call => call.Operation is "Update" or "Create");
        }

        [Fact]
        public void An_invalid_address_is_refused_in_the_users_language()
        {
            var run = Run("Create", new Entity("contact") { ["emailaddress1"] = "ann@example" }).InLanguage(PluginRun.Dutch);

            var refusal = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new ValidateContactEmail(null, null)));

            // Dutch when the project offers Dutch, the source language otherwise.
            Assert.Equal(Messages.Format("contact.email.invalid", Messages.LanguageFor(PluginRun.Dutch)), refusal.Message);
        }

        [Fact]
        public void An_unknown_language_falls_back_to_the_source_language()
        {
            var run = Run("Create", new Entity("contact") { ["emailaddress1"] = "nope" }).InLanguage(1036);

            var refusal = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new ValidateContactEmail(null, null)));

            Assert.Equal(Messages.Format("contact.email.invalid", Messages.SourceLanguage), refusal.Message);
        }

        [Fact]
        public void A_too_long_address_names_the_maximum()
        {
            var run = Run("Update", new Entity("contact") { ["emailaddress1"] = new string('a', 120) + "@example.com" });

            var refusal = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new ValidateContactEmail(null, null)));

            Assert.Contains("100", refusal.Message, StringComparison.Ordinal);
            Assert.DoesNotContain("{maximum}", refusal.Message, StringComparison.Ordinal);
        }

        [Fact]
        public void An_update_without_the_column_or_clearing_it_does_nothing()
        {
            var untouched = Run("Update", new Entity("contact") { ["lastname"] = "Smith" });
            untouched.Execute(new ValidateContactEmail(null, null));
            var cleared = Run("Update", new Entity("contact") { ["emailaddress1"] = null });
            cleared.Execute(new ValidateContactEmail(null, null));

            Assert.Empty(untouched.Service.Calls);
            Assert.Empty(cleared.Service.Calls);
        }

        [Fact]
        public void The_trace_never_holds_the_address()
        {
            var run = Run("Create", new Entity("contact") { ["emailaddress1"] = "secret.person@example" });

            Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new ValidateContactEmail(null, null)));

            Assert.NotEmpty(run.Tracing.Lines);
            Assert.DoesNotContain("secret.person", run.Tracing.All, StringComparison.OrdinalIgnoreCase);
        }
    }

    public class SetAccountPrimaryContactTests
    {
        private static (PluginRun Run, Entity Account, Entity Contact) Arrange(EntityReference? primaryContact)
        {
            var account = new Entity("account", Guid.NewGuid()) { ["name"] = "Contoso Ltd", ["primarycontactid"] = primaryContact };
            var contact = new Entity("contact", Guid.NewGuid()) { ["parentcustomerid"] = account.ToEntityReference() };
            var run = new PluginRun("Create", "contact", PipelineStage.PostOperation, asynchronous: true).WithTarget(contact);
            run.Service.Seed(account);
            return (run, account, contact);
        }

        [Fact]
        public void Becomes_primary_contact_of_an_account_without_one_writing_only_that_column()
        {
            var (run, account, contact) = Arrange(null);

            run.Execute(new SetAccountPrimaryContact(null, null));

            Assert.Equal(contact.Id, run.Service.Stored("account", account.Id)!.GetAttributeValue<EntityReference>("primarycontactid").Id);
            var update = Assert.Single(run.Service.Calls, call => call.Operation == "Update");
            Assert.Equal(new[] { "primarycontactid" }, update.Columns);
            var read = Assert.Single(run.Service.Calls, call => call.Operation == "Retrieve");
            Assert.Equal(new[] { "primarycontactid" }, read.Columns);
        }

        [Fact]
        public void Leaves_an_existing_primary_contact_alone_so_a_retried_job_changes_nothing()
        {
            var existing = new EntityReference("contact", Guid.NewGuid());
            var (run, account, _) = Arrange(existing);

            run.Execute(new SetAccountPrimaryContact(null, null));
            run.Execute(new SetAccountPrimaryContact(null, null));

            Assert.Equal(existing.Id, run.Service.Stored("account", account.Id)!.GetAttributeValue<EntityReference>("primarycontactid").Id);
            Assert.DoesNotContain(run.Service.Calls, call => call.Operation == "Update");
        }

        [Fact]
        public void Does_nothing_without_a_parent_account()
        {
            var run = new PluginRun("Create", "contact", PipelineStage.PostOperation, asynchronous: true)
                .WithTarget(new Entity("contact") { ["parentcustomerid"] = new EntityReference("contact", Guid.NewGuid()) });

            run.Execute(new SetAccountPrimaryContact(null, null));

            Assert.Empty(run.Service.Calls);
        }

        [Fact]
        public void Runs_as_the_steps_user_not_as_system()
        {
            var (run, _, _) = Arrange(null);

            run.Execute(new SetAccountPrimaryContact(null, null));

            Assert.Equal(new Guid?[] { run.Context.UserId }, run.Factory.UsersAskedFor.Distinct().ToArray());
        }
    }

    public class NormalizeEmailApiTests
    {
        private static PluginRun Run(object? email) =>
            new PluginRun(NormalizeEmailApi.MessageName, "none", PipelineStage.MainOperation).WithInput("Email", email);

        [Fact]
        public void Returns_the_tidied_address_and_whether_it_is_valid()
        {
            var run = Run(" Ann@Example.COM ");

            run.Execute(new NormalizeEmailApi(null, null));

            Assert.Equal("Ann@example.com", run.Context.OutputParameters["NormalizedEmail"]);
            Assert.Equal(true, run.Context.OutputParameters["IsValid"]);
        }

        [Fact]
        public void An_invalid_address_is_an_answer_not_an_error()
        {
            var run = Run("not an address");

            run.Execute(new NormalizeEmailApi(null, null));

            Assert.Equal(false, run.Context.OutputParameters["IsValid"]);
        }

        [Fact]
        public void A_missing_address_is_refused()
        {
            var run = Run(null);

            var refusal = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new NormalizeEmailApi(null, null)));

            Assert.Equal(Messages.Format("api.email.required", "en"), refusal.Message);
        }
    }

    public class PluginBaseTests
    {
        private sealed class Failing : PluginBase
        {
            protected override void ExecuteDataversePlugin(ILocalPluginContext context) =>
                throw new InvalidOperationException("internal detail: row for jan@example.com");
        }

        private sealed class Refusing : PluginBase
        {
            protected override void ExecuteDataversePlugin(ILocalPluginContext context) =>
                throw new InvalidPluginExecutionException("As written for the user.");
        }

        [Fact]
        public void An_unexpected_error_becomes_one_localised_sentence_with_the_correlation_id()
        {
            var run = new PluginRun("Update", "contact", PipelineStage.PostOperation).InLanguage(PluginRun.Dutch);

            var error = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new Failing()));

            Assert.Contains(run.Context.CorrelationId.ToString(), error.Message, StringComparison.Ordinal);
            Assert.Equal(
                Messages.Format("error.unexpected", Messages.LanguageFor(PluginRun.Dutch), new Dictionary<string, string> { ["correlationId"] = run.Context.CorrelationId.ToString() }),
                error.Message);
            Assert.DoesNotContain("internal detail", error.Message, StringComparison.Ordinal);
            Assert.Null(error.InnerException);
        }

        [Fact]
        public void The_trace_names_the_exception_type_but_not_its_message()
        {
            var run = new PluginRun("Update", "contact", PipelineStage.PostOperation);

            Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new Failing()));

            Assert.Contains("System.InvalidOperationException", run.Tracing.All, StringComparison.Ordinal);
            Assert.DoesNotContain("jan@example.com", run.Tracing.All, StringComparison.Ordinal);
            Assert.Contains(run.Tracing.Lines, line => line.IndexOf("done in", StringComparison.Ordinal) >= 0);
        }

        [Fact]
        public void A_refusal_passes_through_untouched()
        {
            var run = new PluginRun("Update", "contact", PipelineStage.PreOperation);

            var refusal = Assert.Throws<InvalidPluginExecutionException>(() => run.Execute(new Refusing()));

            Assert.Equal("As written for the user.", refusal.Message);
        }

        [Fact]
        public void The_language_is_read_only_when_a_message_is_needed()
        {
            var run = new PluginRun("Create", "contact", PipelineStage.PreOperation)
                .WithTarget(new Entity("contact") { ["emailaddress1"] = "ann@example.com" });

            run.Execute(new ValidateContactEmail(null, null));

            Assert.DoesNotContain(run.Service.Calls, call => call.Table == "usersettings");
        }
    }
}
