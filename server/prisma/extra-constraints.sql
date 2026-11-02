-- Rules the Mongoose models enforce that a plain Prisma column cannot express. To be added in the first migration (as
-- custom SQL), after the tables exist.
--
-- Every CHECK is NOT VALID: it is enforced for new and changed rows straight away, but existing rows are not scanned, so
-- the data migration cannot fail on an old row that predates a rule. After the migration, run the matching
-- "ALTER TABLE ... VALIDATE CONSTRAINT ..." line; if it fails, it names the rows to look at.

-- Requisition.title: minlength 5
ALTER TABLE requisitions ADD CONSTRAINT requisitions_title_min_length CHECK (char_length(title) >= 5) NOT VALID;

-- Requisition.hireThreshold and maybeThreshold: min 1, max 5
ALTER TABLE requisitions ADD CONSTRAINT requisitions_hire_threshold_range CHECK ("hireThreshold" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE requisitions ADD CONSTRAINT requisitions_maybe_threshold_range CHECK ("maybeThreshold" BETWEEN 1 AND 5) NOT VALID;

-- Candidate.phone: empty, or exactly 11 digits (the Mongoose validator)
ALTER TABLE candidates ADD CONSTRAINT candidates_phone_format CHECK (phone IS NULL OR phone = '' OR phone ~ '^[0-9]{11}$') NOT VALID;

-- Department.name: MongoDB also kept a case-insensitive index on the name (collation en, strength 2)
CREATE INDEX departments_name_lower_idx ON departments (lower(name));

-- After the data migration:
-- ALTER TABLE requisitions VALIDATE CONSTRAINT requisitions_title_min_length;
-- ALTER TABLE requisitions VALIDATE CONSTRAINT requisitions_hire_threshold_range;
-- ALTER TABLE requisitions VALIDATE CONSTRAINT requisitions_maybe_threshold_range;
-- ALTER TABLE candidates VALIDATE CONSTRAINT candidates_phone_format;
