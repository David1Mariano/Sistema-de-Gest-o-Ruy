/** Explicit opt-in. No IndexedDB fallback and no cloud imports. */
export function createLocalFinanceClient({ fetchImpl = globalThis.fetch, getToken, baseUrl = '' }) {
  async function request(path, body) {
    const response = await fetchImpl(`${baseUrl}/api/financeiro${path}`, {
      method: body ? 'POST' : 'GET', cache:'no-store', credentials:'omit',
      headers: { Authorization:`Bearer ${getToken()}`, ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error); error.status = response.status; throw error; }
    return data;
  }
  const execute = (operationId, changes) => request('/operations',{operationId,changes});
  return {
    execute,
    entity(name) {
      const root = `/entities/${encodeURIComponent(name)}`;
      const filter = (query = {}, sort = '-created_date', limit = 1000) => request(`${root}?${new URLSearchParams({query:JSON.stringify(query),sort,limit:String(limit)})}`);
      return {
        list: (sort,limit) => filter({},sort,limit), filter,
        get: id => request(`${root}/${encodeURIComponent(id)}`),
        async create(data, operationId = globalThis.crypto.randomUUID()) {
          return (await execute(operationId,[{action:'create',entity:name,id:data.id,data}]))[0];
        },
        async update(id,data,{expectedVersion,operationId = globalThis.crypto.randomUUID()} = {}) {
          if (!Number.isInteger(expectedVersion)) throw new Error('expectedVersion_required');
          return (await execute(operationId,[{action:'update',entity:name,id,data,expectedVersion}]))[0];
        },
      };
    },
  };
}
