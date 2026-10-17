-- RC2 new synthetic fixtures only.
CREATE TABLE d1_business_local (
 actor uuid PRIMARY KEY REFERENCES lab_users,workspace uuid NOT NULL,head bigint NOT NULL,
 state jsonb NOT NULL,applied boolean NOT NULL
);
