DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS public.tbl_employee_monthly (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES public.tbl_employees(id) ON DELETE RESTRICT,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year >= 2000),
      mrate NUMERIC(12,2) NOT NULL DEFAULT 0,
      basic_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_days INTEGER NOT NULL DEFAULT 0,
      present_days NUMERIC(6,2) NOT NULL DEFAULT 0,
      overtime_hours NUMERIC(12,2) NOT NULL DEFAULT 0,
      advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      calculated_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      salary_data JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_employee_month UNIQUE(employee_id, month, year)
  );
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_month
ON public.tbl_employee_monthly(employee_id, month, year);

ALTER TABLE IF EXISTS public.tbl_employee_attendance
  ADD COLUMN IF NOT EXISTS monthly_employee_id INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'tbl_employee_attendance'
      AND constraint_name = 'tbl_employee_attendance_employee_id_fkey'
  ) THEN
    ALTER TABLE public.tbl_employee_attendance
      DROP CONSTRAINT tbl_employee_attendance_employee_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'tbl_employee_attendance'
      AND constraint_name = 'uq_monthly_employee_day'
  ) THEN
    ALTER TABLE public.tbl_employee_attendance
      DROP CONSTRAINT uq_monthly_employee_day;
  END IF;
END $$;

ALTER TABLE public.tbl_employee_attendance
  ADD CONSTRAINT fk_attendance_monthly_employee
  FOREIGN KEY (monthly_employee_id)
  REFERENCES public.tbl_employee_monthly(id)
  ON DELETE CASCADE;

ALTER TABLE public.tbl_employee_attendance
  ADD CONSTRAINT uq_monthly_employee_day
  UNIQUE (monthly_employee_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendance_monthly_employee
ON public.tbl_employee_attendance(monthly_employee_id);

CREATE INDEX IF NOT EXISTS idx_attendance_date
ON public.tbl_employee_attendance(attendance_date);

CREATE TABLE IF NOT EXISTS public.tbl_employees (
    id SERIAL PRIMARY KEY,
    sno INTEGER NOT NULL,
    emp_id VARCHAR(50) NOT NULL UNIQUE,
    employee_name VARCHAR(150) NOT NULL,
    father_name VARCHAR(150) NOT NULL,
    department VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  payroll_row RECORD;
  attendance_row RECORD;
  monthly_id INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tbl_employee_monthly'
  ) THEN
    INSERT INTO public.tbl_employee_monthly (
      employee_id, month, year, mrate, basic_salary, total_days, present_days, overtime_hours,
      advance_amount, calculated_salary, salary_data, created_at, updated_at
    )
    SELECT
      sb.employee_id,
      sb.month,
      sb.year,
      COALESCE(sb.mrate, 0),
      COALESCE(sb.basic_salary, 0),
      COALESCE(sb.total_days, 0),
      COALESCE(sb.present_days, 0),
      COALESCE(sb.overtime_hours, 0),
      COALESCE(sb.advance_amount, 0),
      COALESCE(sb.calculated_salary, 0),
      sb.data,
      NOW(),
      NOW()
    FROM public.tbl_employee_monthly sb
    ON CONFLICT (employee_id, month, year)
    DO UPDATE SET
      mrate = EXCLUDED.mrate,
      basic_salary = EXCLUDED.basic_salary,
      total_days = EXCLUDED.total_days,
      present_days = EXCLUDED.present_days,
      overtime_hours = EXCLUDED.overtime_hours,
      advance_amount = EXCLUDED.advance_amount,
      calculated_salary = EXCLUDED.calculated_salary,
      salary_data = EXCLUDED.salary_data,
      updated_at = NOW();

    FOR payroll_row IN
      SELECT id, employee_id, month, year FROM public.tbl_employee_monthly
    LOOP
      FOR attendance_row IN
        SELECT id, attendance_date
        FROM public.tbl_employee_attendance
        WHERE employee_id = payroll_row.employee_id
          AND EXTRACT(MONTH FROM attendance_date) = payroll_row.month
          AND EXTRACT(YEAR FROM attendance_date) = payroll_row.year
      LOOP
        UPDATE public.tbl_employee_attendance
        SET monthly_employee_id = payroll_row.id
        WHERE id = attendance_row.id;
      END LOOP;
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.tbl_employee_attendance
  DROP COLUMN IF EXISTS employee_id;
