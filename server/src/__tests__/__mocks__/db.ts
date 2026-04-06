// Lightweight mock of src/db.ts — no real Postgres connection needed.
// Only used by tests that import modules which depend on the pool.

const pool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }),
};

export async function initDb() {}
export default pool;
