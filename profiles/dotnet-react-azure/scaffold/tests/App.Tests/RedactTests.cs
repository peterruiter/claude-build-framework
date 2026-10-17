namespace App.Tests;

using App.Api;

/// <summary>What may reach a log line: no tokens, paths, ids or email addresses.</summary>
public sealed class RedactTests
{
    [Fact]
    public void A_url_keeps_only_scheme_and_host()
    {
        Redact.Url("https://api.example.com/users/42?token=secret#x").Should().Be("https://api.example.com");
        Redact.Url("http://localhost:5080/api/items").Should().Be("http://localhost:5080");
        Redact.Url("/relative/path").Should().Be("(relative url)");
        Redact.Url(null).Should().BeEmpty();
    }

    [Fact]
    public void An_email_keeps_only_its_domain()
    {
        Redact.Email("person@example.com").Should().Be("***@example.com");
        Redact.Email("not an address").Should().Be("***");
    }

    [Fact]
    public void Free_text_loses_every_url_path_and_email_address()
    {
        var message = "POST https://crm.example.com/contacts/77?key=abc failed for person.name@example.org: 500";
        var redacted = Redact.Text(message);
        redacted.Should().Be("POST https://crm.example.com failed for ***@example.org: 500");
        redacted.Should().NotContain("abc").And.NotContain("person.name").And.NotContain("/contacts/77");
    }
}
