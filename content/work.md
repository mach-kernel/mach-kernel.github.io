---
title: Work
type: page
contributions:
  duckdb:
    name: DuckDB
    pulls:
      - duckdb/duckdb-java: 107
        description: |
          Enabled use of the Appender API for raw byte[] appends, eliminating
          an extra copy when called from Java
      - duckdb/duckdb: 18319
        description: | 
          Improved ART index projection/column binding logic to fix index
          scans for views that had column orders differing from that of the 
          underlying table
      - spiceai/duckdb: 7
        description: |
          Enables ART index scans with composite keys by implementing a new ART
          index scan and state for equality assertions. Before this change, composite
          keys were only supported for enforcing uniqueness constraints. Now they can
          be queried too!
  datafusion:
    name: Apache DataFusion
    pulls:
      - datafusion-contrib/datafusion-table-providers: 409
        description: |
          Enabled federation to AWS Redshift (and older PG) via special "quirk"
          enabling PostgreSQL 8 compatible schema inference
          (no JSON, composites, enums, etc)
      - apache/datafusion: 17911
        description: |
          Fix proto reification of `ListingScan` nodes when projecting 
          partition columns
      - apache/datafusion: 17966
        description: |
          Preserve schema metadata for `DataSourceExec` / `FileScanConfig` across
          proto ser/de boundary
      - apache/datafusion-ballista: 1332
        description: Fix executor panics when default tmpfs is not writeable
      - spiceai/datafusion-ballista: 1
        needs-upstream: true
        description: |
          Decouple Ballista client from scheduler runtime customizations & implement
          basic catalog RPC, allowing any Ballista client to create logical plans
          against ANY Ballista scheduler regardless of runtime customizations (e.g.
          without having to know about concrete implementations of `TableProvider`, 
          custom logical nodes, etc.). It also enables clients to query tables in the
          scheduler's catalog without requiring clients to configure all data sources
          themselves.
    
  spiceai:
    name: Spice AI
    pulls:
      - spiceai/spiceai: 1204
        description: | 
          Wrote ODBC data connector enabling federation to ~hundreds of databases 
          (and platforms like Salesforce)
      - spiceai/spiceai: 6846
        description: |
          Added static embedding model support via Model2Vec with in-process
          parallelism to increase vector embedding throughput by over 10x
      - spiceai/spiceai: 6967
        description: |
          Added UDF for vector embeddings to allow SQL/DF native expression of vector
          embeddings during ingestion and search
      - spiceai/spiceai: 7090
        description: |
          Introduced hybrid search UDTF with an easy high-level API for
          [Reciprocal-Rank-Fusion](https://docs.singlestore.com/db/v9.0/developer-resources/functional-extensions/hybrid-search-re-ranking-and-blending-searches/),
          supporting variadic subqueries, custom smoothing, custom join key, and
          rank/recency boosting with customizable decay.
      - spiceai/spiceai: 7585
        description: |
          Integrated Apache Ballista to scale Spice AI's database runtime past
          a single process and to a clustered execution model. Implemented physical
          planning optimizations 

  retro:
    pulls:
      - mach-kernel/cadius: 13
        description: | 
          Implemented ser/de for AppleSingle files to/from ProDOS for the popular
          CADIUS disk image utility
  
  swagger:
    pulls:
      - swagger-api/swagger-codegen: 1441
        description: |
          Meta-PR that fixed:
            - OAuth 2 for Python, Ruby, PHP
            - Nested DTO ser/de
            - `LOCATION` header consistency
            - Support for hypermedia style path identifiers

  misc:
    pulls:
      - komamitsu/fluency: 450
        description: | 
          Feature to allow customization of `SSLSocketFactory` for Java
          fluentd/fluent bit ingestion logger
      - newrelickk/logback-newrelic-appender: 10
        description: GZIP NewRelic API requests to allow sending larger frames
      - nulldb/nulldb: 86
        description: Fixed count(*) queries for widely used no-op ActiveRecord adapter
      - davidcelis/api-pagination: 95
        description: Fixed string inflector for popular Rails API pagination library
      - watsonbox/pocketsphinx-ruby: 28
        description: Remove a deprecated function from FFI bindings
      - ruby-grape/grape-roar: 22
        description: |
          Wrote ActiveRecord/Mongoid relation extension for ruby-grape's hypermedia
          presenter library, allowing easy declaration -> auto-generation of HAL links
          from ORM relationships
      - jekyll/classifier-reborn: 168
        description: |
          Enabled popular classifier library to run on JRuby by hooking up a native Java stemming library
      - kashifrazzaqui/json-streamer: 4
        description: Fixed string deserialization for Python YAJL library
      
---

This is the work page!!!
