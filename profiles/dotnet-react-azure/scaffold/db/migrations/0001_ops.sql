-- ===========================================================================
-- Schemas, and the operational tables every product built on this profile has.
--
--   ops   the product's own plumbing: the migration ledger (created by the
--         runner itself), shared rate limit counters.
--   app   the product's data. Rename or add schemas in later migrations.
--
-- Idempotent: creates what is absent and leaves what is present alone, so it
-- applies to a brand-new database and a second time cleanly. Never edit this
-- file once it has been applied anywhere; write a new migration.
-- ===========================================================================

IF SCHEMA_ID('ops') IS NULL EXEC('CREATE SCHEMA ops');
GO
IF SCHEMA_ID('app') IS NULL EXEC('CREATE SCHEMA app');
GO

-- ------------------------------------------------------------ rate limits --
-- One row per limit and partition (an address, a key): how many calls its
-- current window took and when the window ends. Shared by every replica, so a
-- limit of ten a minute is ten however many replicas answer. The partition is
-- a 128-bit hash (RateCounterStore.Key), so no address is kept in clear.
IF OBJECT_ID('ops.RateCounter') IS NULL
BEGIN
    CREATE TABLE ops.RateCounter
    (
        PartitionKey  BINARY(16)   NOT NULL CONSTRAINT PK_RateCounter PRIMARY KEY,
        UntilUtc      DATETIME2(3) NOT NULL,
        Hits          INT          NOT NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RateCounter_UntilUtc' AND object_id = OBJECT_ID('ops.RateCounter'))
    CREATE INDEX IX_RateCounter_UntilUtc ON ops.RateCounter (UntilUtc);
GO
