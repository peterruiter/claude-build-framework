namespace App.Data;

using Microsoft.Data.SqlClient;

/// <summary>Creates the database named in a connection string when it is missing: for a laptop only.</summary>
/// <remarks>
/// A deployed database is created by infra/ (Bicep) and migrated by a person (Initialize-Database.ps1).
/// On a laptop the person running the API is the person who would run the migrations, so Development
/// creates and migrates its own LocalDB database on start (Database:ApplyMigrations).
/// </remarks>
public static class LocalDatabaseBootstrap
{
    /// <summary>Creates the database when it does not exist.</summary>
    /// <param name="connectionString">The database; its server must accept CREATE DATABASE from this login.</param>
    /// <param name="cancellationToken">Cancellation.</param>
    public static async Task EnsureCreatedAsync(string connectionString, CancellationToken cancellationToken)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        var database = builder.InitialCatalog;
        if (string.IsNullOrWhiteSpace(database)) throw new InvalidOperationException("The connection string names no database.");

        builder.InitialCatalog = "master";
        await using var master = new SqlConnection(builder.ConnectionString);
        await master.OpenAsync(cancellationToken);
        await using var create = master.CreateCommand();
        create.CommandText = "IF DB_ID(@name) IS NULL BEGIN DECLARE @sql NVARCHAR(400) = N'CREATE DATABASE ' + QUOTENAME(@name); EXEC (@sql); END";
        create.Parameters.AddWithValue("@name", database);
        await create.ExecuteNonQueryAsync(cancellationToken);
    }
}
