-- RC2: new synthetic databases only; never a startup migration.
CREATE TABLE d1_business_stock (
 workspace uuid NOT NULL,item uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity>=0),
 average bigint NOT NULL CHECK(average>=0),last_cost bigint NOT NULL CHECK(last_cost>=0),version bigint NOT NULL,
 PRIMARY KEY(workspace,item)
);
CREATE TABLE d1_business_accounts (
 workspace uuid NOT NULL,account text NOT NULL,balance bigint NOT NULL,version bigint NOT NULL,
 PRIMARY KEY(workspace,account)
);
CREATE TABLE d1_business_movements (
 workspace uuid NOT NULL,operation uuid NOT NULL,item uuid NOT NULL,delta bigint NOT NULL,
 cost bigint NOT NULL,balance bigint NOT NULL,kind text NOT NULL,item_name text NOT NULL,unit text NOT NULL,PRIMARY KEY(workspace,operation,item)
);
CREATE TABLE d1_business_entries (
 workspace uuid NOT NULL,operation uuid NOT NULL,account text NOT NULL,cents bigint NOT NULL,
 PRIMARY KEY(workspace,operation,account)
);
CREATE TABLE d1_business_settlements (
 workspace uuid NOT NULL,obligation text NOT NULL,record_id uuid NOT NULL,signature text NOT NULL,
 PRIMARY KEY(workspace,obligation),UNIQUE(workspace,record_id)
);

CREATE TABLE d1_business_reversals(workspace uuid NOT NULL,reference uuid NOT NULL,operation uuid NOT NULL,reason text NOT NULL,PRIMARY KEY(workspace,reference),UNIQUE(workspace,operation));
