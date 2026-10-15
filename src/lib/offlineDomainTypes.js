/**
 * Optional capabilities supplied by the isolated D1 adapter. Hosted/local
 * application clients leave this undefined and retain their existing paths.
 * @typedef {{id?: string, _version?: number, [key: string]: unknown}} DomainDocument
 * @typedef {{
 * recipe: (product: DomainDocument, ingredients: DomainDocument[]) => Promise<DomainDocument>,
 * payment: (data: DomainDocument, editing?: DomainDocument) => Promise<DomainDocument>,
 * settle: (payable: DomainDocument, data: DomainDocument) => Promise<DomainDocument>,
 * receive: (record: DomainDocument) => Promise<DomainDocument>,
 * generate: (record: DomainDocument) => Promise<DomainDocument>,
 * entry: (type: string, form: DomainDocument, account?: DomainDocument) => Promise<DomainDocument>,
 * ConsumptionControls?: import('react').ComponentType<{record: DomainDocument}>
 * }} LocalDomain
 */
export {};
