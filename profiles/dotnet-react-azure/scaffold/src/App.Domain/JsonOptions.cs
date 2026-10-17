namespace App.Domain;

using System.Text.Json;

/// <summary>The JSON settings shared by the contracts and the API.</summary>
public static class JsonOptions
{
    /// <summary>camelCase in files, case-insensitive on read, comments allowed in contracts.</summary>
    public static readonly JsonSerializerOptions Contracts = new(JsonSerializerDefaults.Web)
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };
}
