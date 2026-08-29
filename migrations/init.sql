-- Initial schema for KumarExports

CREATE TABLE IF NOT EXISTS tbl_departments (
    id SERIAL PRIMARY KEY,
    departmentname VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_roles (
    id SERIAL PRIMARY KEY,
    rolename VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS tbl_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password TEXT,
    roleid INT,
    departmentid INT,
    CONSTRAINT fk_role
        FOREIGN KEY(roleid)
        REFERENCES tbl_roles(id),
    CONSTRAINT fk_department
        FOREIGN KEY(departmentid)
        REFERENCES tbl_departments(id)
);

CREATE TABLE IF NOT EXISTS tbl_employees (
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

CREATE TABLE IF NOT EXISTS tbl_employee_monthly (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL
        REFERENCES tbl_employees(id)
        ON DELETE RESTRICT,
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

CREATE INDEX IF NOT EXISTS idx_employee_month
  ON tbl_employee_monthly(employee_id, month, year);

CREATE TABLE IF NOT EXISTS tbl_employee_attendance (
    id SERIAL PRIMARY KEY,
    monthly_employee_id INTEGER NOT NULL
        REFERENCES tbl_employee_monthly(id)
        ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    attendance_status VARCHAR(12) NOT NULL
        CHECK (attendance_status IN ('present', 'half-day', 'absent')),
    overtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
    leave_category VARCHAR(40),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_monthly_employee_day UNIQUE (monthly_employee_id, attendance_date),
    CONSTRAINT tbl_employee_attendance_leave_category_check
        CHECK (leave_category IS NULL OR leave_category IN ('Without Prior Information', 'Leave to be Encashed', 'Leave by ESI'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_monthly_employee
  ON tbl_employee_attendance (monthly_employee_id);

CREATE INDEX IF NOT EXISTS idx_attendance_date
  ON tbl_employee_attendance (attendance_date);
