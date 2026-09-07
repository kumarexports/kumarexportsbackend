require('dotenv').config()
const express = require('express')
const cors = require('cors')
const db = require('./db')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const jwtSecret = process.env.JWT_SECRET
if (process.env.NODE_ENV === 'production' && (!jwtSecret || jwtSecret === 'dev-secret')) {
  throw new Error('JWT_SECRET must be configured with a strong value in production.')
}

const app = express()
const allowedOrigins = String(process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('Origin is not allowed by CORS'))
  },
}))
app.use(express.json({ limit: '25mb' }))

const ensureSchema = async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_salary_finalizations (
      id SERIAL PRIMARY KEY,
      month INT NOT NULL,
      year INT NOT NULL,
      finalized_at TIMESTAMP NOT NULL DEFAULT now(),
      finalized_by INT,
      is_locked BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT uq_tbl_salary_finalizations_month UNIQUE (month, year)
    )`
  )

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_employee_monthly (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES tbl_employees(id) ON DELETE RESTRICT,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year >= 2000),
      mrate NUMERIC(12,2) NOT NULL DEFAULT 0,
      basic_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_basic_package NUMERIC(12,2) NOT NULL DEFAULT 0,
      remaining_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      hra NUMERIC(12,2) NOT NULL DEFAULT 0,
      ta NUMERIC(12,2) NOT NULL DEFAULT 0,
      washing_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_days INTEGER NOT NULL DEFAULT 0,
      present_days NUMERIC(6,2) NOT NULL DEFAULT 0,
      overtime_hours NUMERIC(12,2) NOT NULL DEFAULT 0,
      advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      calculated_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      salary_data JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_employee_month UNIQUE(employee_id, month, year)
    )`
  )

  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS total_basic_package NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS hra NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS ta NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS washing_allowance NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employee_monthly ADD COLUMN IF NOT EXISTS salary_data JSONB`)

  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS mrate NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS basic_package NUMERIC(12,2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS company VARCHAR(150)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS pf_value VARCHAR(40)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS pfvol_value VARCHAR(40)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS esi_value VARCHAR(40)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS tds_value VARCHAR(40)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS prof_tax_value VARCHAR(40)`)
  await db.query(`ALTER TABLE IF EXISTS tbl_employees ADD COLUMN IF NOT EXISTS import_data JSONB`)

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_salary_increment_history (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES tbl_employees(id) ON DELETE RESTRICT,
      increment_type VARCHAR(20) NOT NULL CHECK (increment_type IN ('fixed', 'percentage')),
      increment_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      effective_month INTEGER NOT NULL CHECK (effective_month BETWEEN 1 AND 12),
      effective_year INTEGER NOT NULL CHECK (effective_year >= 2000),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`
  )

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_persons (
      id SERIAL PRIMARY KEY,
      emp_id VARCHAR(50) NOT NULL UNIQUE,
      employee_name VARCHAR(150) NOT NULL,
      father_name VARCHAR(150) NOT NULL,
      department VARCHAR(100) NOT NULL,
      basic_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
      present_days NUMERIC(8,2) NOT NULL DEFAULT 0,
      total_days INTEGER NOT NULL DEFAULT 0,
      pf NUMERIC(14,2) NOT NULL DEFAULT 0,
      pfvol NUMERIC(14,2) NOT NULL DEFAULT 0,
      esi NUMERIC(14,2) NOT NULL DEFAULT 0,
      tds NUMERIC(14,2) NOT NULL DEFAULT 0,
      advance NUMERIC(14,2) NOT NULL DEFAULT 0,
      plwf NUMERIC(14,2) NOT NULL DEFAULT 0,
      prof_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      import_data JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`
  )

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_advances (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES tbl_employees(id) ON DELETE RESTRICT,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year >= 2000),
      advance NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_tbl_advances_employee_month UNIQUE (employee_id, month, year)
    )`
  )

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_employee_month
    ON tbl_employee_monthly(employee_id, month, year)`
  )

  await db.query(
    `ALTER TABLE IF EXISTS tbl_employee_attendance
      ADD COLUMN IF NOT EXISTS monthly_employee_id INTEGER`
  )

  await db.query(
    `ALTER TABLE IF EXISTS tbl_employee_attendance
      ADD COLUMN IF NOT EXISTS leave_category VARCHAR(40)`
  )

  await db.query(
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tbl_employee_attendance'
          AND constraint_name = 'tbl_employee_attendance_employee_id_fkey'
      ) THEN
        ALTER TABLE tbl_employee_attendance
          DROP CONSTRAINT tbl_employee_attendance_employee_id_fkey;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tbl_employee_attendance'
          AND constraint_name = 'tbl_employee_attendance_attendance_status_check'
      ) THEN
        ALTER TABLE tbl_employee_attendance
          DROP CONSTRAINT tbl_employee_attendance_attendance_status_check;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tbl_employee_attendance'
          AND constraint_name = 'fk_attendance_monthly_employee'
      ) THEN
        ALTER TABLE tbl_employee_attendance
          DROP CONSTRAINT fk_attendance_monthly_employee;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tbl_employee_attendance'
          AND constraint_name = 'uq_monthly_employee_day'
      ) THEN
        ALTER TABLE tbl_employee_attendance
          DROP CONSTRAINT uq_monthly_employee_day;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'tbl_employee_attendance'
          AND constraint_name = 'tbl_employee_attendance_leave_category_check'
      ) THEN
        ALTER TABLE tbl_employee_attendance
          DROP CONSTRAINT tbl_employee_attendance_leave_category_check;
      END IF;

      ALTER TABLE tbl_employee_attendance
        ADD CONSTRAINT tbl_employee_attendance_attendance_status_check
        CHECK (attendance_status IN ('present', 'half-day', 'absent'));

      ALTER TABLE tbl_employee_attendance
        ADD CONSTRAINT fk_attendance_monthly_employee
        FOREIGN KEY (monthly_employee_id)
        REFERENCES tbl_employee_monthly(id)
        ON DELETE CASCADE;

      ALTER TABLE tbl_employee_attendance
        ADD CONSTRAINT uq_monthly_employee_day UNIQUE (monthly_employee_id, attendance_date);

      ALTER TABLE tbl_employee_attendance
        ADD CONSTRAINT tbl_employee_attendance_leave_category_check
        CHECK (leave_category IS NULL OR leave_category IN ('Without Prior Information', 'Leave to be Encashed', 'Leave by ESI'));
    END $$;`
  )

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_finalized_salary_records (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES tbl_employees(id) ON DELETE RESTRICT,
      month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INT NOT NULL,
      present_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
      final_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT uq_finalized_salary_employee_month UNIQUE (employee_id, month, year)
    )`
  )

  await db.query(
    `CREATE TABLE IF NOT EXISTS tbl_government_salary_records (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES tbl_employees(id) ON DELETE RESTRICT,
      month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INT NOT NULL,
      source_present_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
      present_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
      total_days INT NOT NULL,
      additional_absent_days INT NOT NULL DEFAULT 0,
      final_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
      source_basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
      basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
      updated_basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0,
      remaining_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      hra NUMERIC(14, 2) NOT NULL DEFAULT 0,
      ta NUMERIC(14, 2) NOT NULL DEFAULT 0,
      washing_allowance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      conveyance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      ot_allowance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      incentive NUMERIC(14, 2) NOT NULL DEFAULT 0,
      total_earnings NUMERIC(14, 2) NOT NULL DEFAULT 0,
      pf NUMERIC(14, 2) NOT NULL DEFAULT 0,
      pfvol NUMERIC(14, 2) NOT NULL DEFAULT 0,
      esi NUMERIC(14, 2) NOT NULL DEFAULT 0,
      tds NUMERIC(14, 2) NOT NULL DEFAULT 0,
      advance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      other_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
      plwf NUMERIC(14, 2) NOT NULL DEFAULT 0,
      other_deductions NUMERIC(14, 2) NOT NULL DEFAULT 0,
      professional_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
      total_deductions NUMERIC(14, 2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      saved_final_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT uq_government_salary_employee_month UNIQUE (employee_id, month, year)
    )`
  )

  await db.query(`ALTER TABLE IF EXISTS tbl_government_salary_records ADD COLUMN IF NOT EXISTS final_salary NUMERIC(14, 2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_government_salary_records ADD COLUMN IF NOT EXISTS source_basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_government_salary_records ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(14, 2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_government_salary_records ADD COLUMN IF NOT EXISTS ta NUMERIC(14, 2) NOT NULL DEFAULT 0`)
  await db.query(`ALTER TABLE IF EXISTS tbl_government_salary_records ADD COLUMN IF NOT EXISTS washing_allowance NUMERIC(14, 2) NOT NULL DEFAULT 0`)
}

const calculateSalary = (mRate, presentDays, totalDays, overtimeHours) => {
  const rate = Number(mRate) || 0
  const present = Number(presentDays) || 0
  const total = Number(totalDays) || 0
  const overtime = Number(overtimeHours) || 0

  if (!rate || !total) {
    return 0
  }

  const baseSalary = rate * (present / total)
  const overtimeSalary = rate * (overtime / (8 * total))
  return Number((baseSalary + overtimeSalary).toFixed(2))
}

const resolveSalaryBreakupSalary = (row) => {
  const calculatedSalary = Number(row.calculated_salary || 0)
  if (calculatedSalary > 0) {
    return calculatedSalary
  }

  return calculateSalary(row.mrate, row.present_days, row.total_days, row.overtime_hours)
}

const isProtectedFinalizationMonth = (month, year) => Number(month) === 3 && Number(year) === 2026

const getMonthDayList = (month, year) => {
  const monthNumber = Number(month)
  const yearNumber = Number(year)
  const totalDays = new Date(yearNumber, monthNumber, 0).getDate()
  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1
    return `${yearNumber}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
}

const getMonthLabel = (month, year) => new Date(Number(year), Number(month) - 1, 1)
  .toLocaleString('en-US', { month: 'long', year: 'numeric' })

const parsePayrollPeriodFromFileName = (fileName) => {
  const match = String(fileName || '').match(/(?:^|[\s_-])(?:import\s*)?(\d{2})-(\d{4})(?:\s*\(\d+\))?(?:\.xlsx)?(?:[\s_.-]|$)/i)
  if (!match) {
    return null
  }

  const month = Number(match[1])
  const year = Number(match[2])
  if (!month || month < 1 || month > 12 || !year) {
    return null
  }

  return { month, year }
}

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100

const toCents = (value) => Math.round((Number(value) || 0) * 100)

const fromCents = (value) => Number((value / 100).toFixed(2))

const readNumber = (record, keys) => {
  const source = record && typeof record === 'object' ? record : {}
  const normalizedKeys = new Map(Object.entries(source).map(([key, value]) => [key.replace(/[^a-z0-9]/gi, '').toLowerCase(), value]))
  for (const key of keys) {
    const value = normalizedKeys.get(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
    const parsed = Number(String(value ?? '').replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const readPositiveNumber = (record, keys) => {
  const value = readNumber(record, keys)
  return value > 0 ? value : 0
}

const normalizeYesNo = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'yes' || text === 'y' || text === 'true' || text === '1'
}

const resolveMasterDeduction = (rawValue, basicSalary, percentageBase = basicSalary) => {
  const text = String(rawValue ?? '').trim()
  const numeric = Number(String(text).replace(/,/g, '').replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(numeric) || text === '') {
    return 0
  }
  if (numeric < 100) {
    return roundMoney(percentageBase * (numeric / 100))
  }
  return roundMoney(numeric)
}

const resolvePfDeduction = (rawValue, basicSalary) => resolveMasterDeduction(rawValue, basicSalary, basicSalary)

const calculateGovernmentSalary = ({ sourceBasicSalary, presentDays, totalDays, deductions, esiEnabled, targetFinalAmount }) => {
  const safeTotalDays = Math.max(1, Number(totalDays) || 0)
  const sourcePresentDays = Math.max(0, Number(presentDays) || 0)
  const safeSourceBasicSalary = Number(sourceBasicSalary) || 0
  const targetAmount = Number(targetFinalAmount) || 0
  let effectivePresentDays = sourcePresentDays
  let additionalAbsentDays = 0

  const resolveDeduction = (value) => {
    if (value && typeof value === 'object') {
      if (String(value.type || '').toLowerCase() === 'percentage') {
        return roundMoney((safeSourceBasicSalary * (Number(value.amount || 0) / 100)))
      }
      return roundMoney(value.amount || 0)
    }
    return roundMoney(Number(value) || 0)
  }

  const calculateForDays = (days) => {
    const finalSalary = roundMoney(safeSourceBasicSalary * (days / safeTotalDays))
    const basicSalary = roundMoney(finalSalary * 0.65)
    const remainingBalance = roundMoney(finalSalary - basicSalary)
    const hra = roundMoney(remainingBalance * 0.66)
    const ta = roundMoney(remainingBalance * 0.22)
    const washingAllowance = roundMoney(remainingBalance * 0.12)
    const esi = esiEnabled ? roundMoney(basicSalary * 0.0075) : 0
    const pf = resolveDeduction(deductions.pf)
    const pfvol = resolveDeduction(deductions.pfvol)
    const tds = resolveDeduction(deductions.tds)
    const advanceAmount = resolveDeduction(deductions.advanceAmount)
    const plwf = resolveDeduction(deductions.plwf)
    const professionalTax = resolveDeduction(deductions.professionalTax)
    const baseEarningsCents = toCents(basicSalary + hra + ta + washingAllowance)
    const baseDeductionsCents = toCents(pf + pfvol + esi + tds + advanceAmount + plwf + professionalTax)
    return {
      finalSalary,
      basicSalary,
      remainingBalance,
      hra,
      ta,
      washingAllowance,
      esi,
      pf,
      pfvol,
      tds,
      advanceAmount,
      plwf,
      professionalTax,
      baseEarningsCents,
      baseDeductionsCents,
      baseNetCents: baseEarningsCents - baseDeductionsCents,
    }
  }

  let calculation = calculateForDays(effectivePresentDays)
  const targetCents = targetAmount > 0 ? toCents(targetAmount) : calculation.baseNetCents

  while (effectivePresentDays > 0 && calculation.baseNetCents > targetCents) {
    effectivePresentDays -= 1
    additionalAbsentDays += 1
    calculation = calculateForDays(effectivePresentDays)
  }

  const netWithoutProduction = calculation.baseNetCents
  const productionIncentivesCents = Math.max(0, targetCents - netWithoutProduction)
  const productionIncentives = fromCents(productionIncentivesCents)
  const totalEarningsCents = targetAmount > 0
    ? targetCents + calculation.baseDeductionsCents
    : calculation.baseEarningsCents + productionIncentivesCents
  const totalDeductionsCents = calculation.baseDeductionsCents
  const netAmount = targetAmount > 0 ? fromCents(targetCents) : fromCents(totalEarningsCents - totalDeductionsCents)

  return {
    sourcePresentDays,
    presentDays: effectivePresentDays,
    additionalAbsentDays,
    sourceBasicSalary: roundMoney(safeSourceBasicSalary),
    basicSalary: calculation.basicSalary,
    finalSalary: calculation.finalSalary,
    updatedBasicSalary: calculation.finalSalary,
    remainingBalance: calculation.remainingBalance,
    hra: calculation.hra,
    ta: calculation.ta,
    washingAllowance: calculation.washingAllowance,
    conveyance: calculation.ta,
    otAllowance: 0,
    incentive: productionIncentives,
    productionIncentives,
    totalEarnings: fromCents(totalEarningsCents),
    pf: calculation.pf,
    pfvol: calculation.pfvol,
    esi: calculation.esi,
    tds: calculation.tds,
    advanceAmount: calculation.advanceAmount,
    otherDeduction: 0,
    plwf: calculation.plwf,
    otherDeductions: 0,
    professionalTax: calculation.professionalTax,
    totalDeductions: fromCents(totalDeductionsCents),
    netAmount,
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Login endpoint: accepts { email, password } and returns { ok, token, user }
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password required' })

    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.password, u.roleid, u.departmentid,
              d."departmentname" AS "departmentName"
       FROM tbl_users u
       LEFT JOIN tbl_departments d ON d.id = u.departmentid
       WHERE u.email = $1 LIMIT 1`,
      [email],
    )
    if (result.rows.length === 0) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    const user = result.rows[0]
    const match = await bcrypt.compare(password, user.password || '')
    if (!match) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    const token = jwt.sign({ userId: user.id, email: user.email }, jwtSecret || 'dev-secret', { expiresIn: '40m' })

    // return token and basic user info (omit password)
    return res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, roleId: user.roleid, departmentId: user.departmentid, departmentName: user.departmentName } })
  } catch (err) {
    console.error('login error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// Logout endpoint: for JWT stateless auth, logout is handled client-side by discarding token.
app.post('/api/logout', (_req, res) => {
  return res.json({ ok: true })
})

const requireAuth = (req, res, next) => {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ ok: false, error: 'Authentication required.' })
  try {
    req.auth = jwt.verify(token, jwtSecret || 'dev-secret')
    return next()
  } catch {
    return res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' })
  }
}

app.use('/api', requireAuth)

app.get('/api/dashboard/finalized-attendance', async (_req, res) => {
  try {
    const finalizedResult = await db.query(
      `SELECT month, year, finalized_at
       FROM tbl_salary_finalizations
       WHERE is_locked = TRUE
       ORDER BY finalized_at DESC
       LIMIT 1`,
    )
    const finalized = finalizedResult.rows[0]
    if (!finalized) return res.json({ ok: true, finalizedMonth: null, summary: null })

    const [monthlySummaryResult, departmentSummaryResult, topEmployeesResult, payrollSummaryResult] = await Promise.all([
      db.query(
        `SELECT COALESCE(SUM(m.present_days), 0) AS present_days,
                COALESCE(SUM(GREATEST(m.total_days - m.present_days, 0)), 0) AS absent_days,
                0::numeric AS half_day_days,
                COUNT(*) FILTER (WHERE m.present_days > 0)::int AS attendance_entries,
                COALESCE(SUM(m.overtime_hours), 0) AS total_overtime,
                COUNT(*) FILTER (WHERE m.overtime_hours > 0)::int AS overtime_entries,
                COALESCE(AVG(m.overtime_hours) FILTER (WHERE m.overtime_hours > 0), 0) AS average_overtime,
                COUNT(*)::int AS days_updated
         FROM tbl_employee_monthly m
         JOIN tbl_employees e ON e.id = m.employee_id
         WHERE m.month = $1 AND m.year = $2`,
        [finalized.month, finalized.year],
      ),
      db.query(
        `SELECT e.department,
                COUNT(*) FILTER (WHERE m.present_days > 0)::int AS present_count,
                COUNT(*) FILTER (WHERE m.present_days < m.total_days)::int AS absent_count,
                COALESCE(SUM(m.overtime_hours), 0) AS overtime_hours
         FROM tbl_employee_monthly m
         JOIN tbl_employees e ON e.id = m.employee_id
         WHERE m.month = $1 AND m.year = $2
         GROUP BY e.department
         ORDER BY e.department`,
        [finalized.month, finalized.year],
      ),
      db.query(
        `SELECT e.emp_id AS "empId",
                e.employee_name AS "employeeName",
                e.department,
                COALESCE(SUM(m.overtime_hours), 0) AS overtime_hours
         FROM tbl_employee_monthly m
         JOIN tbl_employees e ON e.id = m.employee_id
         WHERE m.month = $1 AND m.year = $2
         GROUP BY e.emp_id, e.employee_name, e.department
         ORDER BY overtime_hours DESC, e.employee_name ASC
         LIMIT 10`,
        [finalized.month, finalized.year],
      ),
      db.query(
        `SELECT COUNT(*)::int AS finalized_employees,
                COALESCE(SUM(final_amount), 0) AS total_final_amount,
                COALESCE(AVG(final_amount), 0) AS average_final_amount,
                COALESCE(MAX(final_amount), 0) AS max_final_amount
         FROM tbl_finalized_salary_records
         WHERE month = $1 AND year = $2`,
        [finalized.month, finalized.year],
      ),
    ])

    const monthlySummary = monthlySummaryResult.rows[0] || {
      present_days: 0,
      half_day_days: 0,
      absent_days: 0,
      attendance_entries: 0,
      total_overtime: 0,
      overtime_entries: 0,
      average_overtime: 0,
      days_updated: 0,
    }
    const departmentRows = departmentSummaryResult.rows || []
    const topEmployeeRows = topEmployeesResult.rows || []
    const payrollSummary = payrollSummaryResult.rows[0] || { finalized_employees: 0, total_final_amount: 0, average_final_amount: 0, max_final_amount: 0 }
    const totalAttendance = Number(monthlySummary.present_days || 0) + Number(monthlySummary.absent_days || 0)
    const presentRate = totalAttendance ? (Number(monthlySummary.present_days || 0) / totalAttendance) * 100 : 0
    const halfDayRate = 0
    const absentRate = totalAttendance ? (Number(monthlySummary.absent_days || 0) / totalAttendance) * 100 : 0

    return res.json({
      ok: true,
      finalizedMonth: { month: finalized.month, year: finalized.year, finalizedAt: finalized.finalized_at },
      summary: {
        status: {
          present: Number(monthlySummary.present_days) || 0,
          'half-day': Number(monthlySummary.half_day_days) || 0,
          absent: Number(monthlySummary.absent_days) || 0,
        },
        overtime: {
          total_overtime: Number(monthlySummary.total_overtime) || 0,
          overtime_entries: Number(monthlySummary.overtime_entries) || 0,
          average_overtime: Number(monthlySummary.average_overtime) || 0,
        },
        daysUpdated: Number(monthlySummary.days_updated) || 0,
        absenteeismRate: Number(absentRate.toFixed(2)),
        departments: departmentRows.map((row) => ({
          department: row.department || 'Unassigned',
          present: Number(row.present_count) || 0,
          absent: Number(row.absent_count) || 0,
          overtime_hours: Number(row.overtime_hours) || 0,
        })),
        topEmployees: topEmployeeRows.map((row) => ({
          empId: row.empId || '',
          employeeName: row.employeeName || '',
          department: row.department || 'Unassigned',
          overtime_hours: Number(row.overtime_hours) || 0,
        })),
        finalizedEmployees: Number(payrollSummary.finalized_employees) || 0,
        totalFinalAmount: Number(payrollSummary.total_final_amount) || 0,
        averageFinalAmount: Number(payrollSummary.average_final_amount) || 0,
        maxFinalAmount: Number(payrollSummary.max_final_amount) || 0,
      },
      currentMonth: {
        month: finalized.month,
        year: finalized.year,
        daysUpdated: Number(monthlySummary.days_updated) || 0,
        absenteeismRate: Number(absentRate.toFixed(2)),
        absentEntries: Number(monthlySummary.absent_days) || 0,
      },
    })
  } catch (err) {
    console.error('dashboard attendance summary error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/settings/reset-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'email, currentPassword and newPassword are required' })
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ ok: false, error: 'newPassword must be at least 6 characters long' })
    }

    const result = await db.query('SELECT id, password FROM tbl_users WHERE email=$1 LIMIT 1', [email])
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' })
    }

    const user = result.rows[0]
    if (!req.auth?.userId || Number(req.auth.userId) !== Number(user.id)) {
      return res.status(403).json({ ok: false, error: 'You can only change your own password.' })
    }
    const validCurrentPassword = await bcrypt.compare(currentPassword, user.password || '')
    if (!validCurrentPassword) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await db.query('UPDATE tbl_users SET password=$1 WHERE id=$2', [hashedPassword, user.id])

    return res.json({ ok: true })
  } catch (err) {
    console.error('reset password error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/settings/users', async (_req, res) => {
  try {
    const permission = await db.query(
      `SELECT u.roleid, u.departmentid, d."departmentname" AS "departmentName"
       FROM tbl_users u LEFT JOIN tbl_departments d ON d.id = u.departmentid
       WHERE u.id = $1 LIMIT 1`,
      [Number(_req.auth.userId)],
    )
    const requester = permission.rows[0]
    if (!requester || Number(requester.roleid) !== 1 || String(requester.departmentName || '').trim().toLowerCase() !== 'it') {
      return res.status(403).json({ ok: false, error: "Only IT department's Admin can handle users." })
    }
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.roleid, u.departmentid,
              r."rolename" AS "roleName",
              d."departmentname" AS "departmentName"
       FROM tbl_users u
       LEFT JOIN tbl_roles r ON r.id = u.roleid
       LEFT JOIN tbl_departments d ON d.id = u.departmentid
       ORDER BY u.id`,
    )
    return res.json({ ok: true, users: result.rows })
  } catch (err) {
    console.error('users fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/settings/users', async (req, res) => {
  try {
    const { name, email, password, canEdit } = req.body
    const permissionResult = await db.query(
      `SELECT u.roleid, d."departmentname" AS "departmentName"
       FROM tbl_users u LEFT JOIN tbl_departments d ON d.id = u.departmentid
       WHERE u.id = $1 LIMIT 1`,
      [Number(req.auth.userId)],
    )
    const requester = permissionResult.rows[0]
    if (!requester || Number(requester.roleid) !== 1 || String(requester.departmentName || '').trim().toLowerCase() !== 'it') {
      return res.status(403).json({ ok: false, error: "Only IT department's Admin can handle users." })
    }
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'name, email and password are required' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ ok: false, error: 'password must be at least 6 characters long' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const result = await db.query(
      `INSERT INTO tbl_users (name, email, password, roleid, departmentid)
       VALUES ($1, $2, $3, $4, 2)
       RETURNING id, name, email, roleid, departmentid`,
      [name.trim(), email.trim(), hashedPassword, canEdit ? 1 : 14],
    )
    return res.status(201).json({ ok: true, user: result.rows[0] })
  } catch (err) {
    console.error('user create error', err)
    return res.status(500).json({ ok: false, error: err.code === '23505' ? 'Email already exists' : err.message })
  }
})

app.delete('/api/settings/users/:id', async (req, res) => {
  try {
    const permission = await db.query(
      `SELECT u.roleid, u.departmentid, d."departmentname" AS "departmentName"
       FROM tbl_users u LEFT JOIN tbl_departments d ON d.id = u.departmentid
       WHERE u.id = $1 LIMIT 1`,
      [Number(req.auth.userId)],
    )
    const requester = permission.rows[0]
    if (!requester || Number(requester.roleid) !== 1 || String(requester.departmentName || '').trim().toLowerCase() !== 'it') {
      return res.status(403).json({ ok: false, error: "Only IT department's Admin can handle users." })
    }
    const result = await db.query('DELETE FROM tbl_users WHERE id = $1 RETURNING id', [Number(req.params.id)])
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'User not found' })
    return res.json({ ok: true })
  } catch (err) {
    console.error('user delete error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/salary-breakups/upsert', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { month, year, rows } = req.body
    const monthNumber = Number(month)
    const yearNumber = Number(year)

    if (!monthNumber || !yearNumber || !Array.isArray(rows)) {
      return res.status(400).json({ ok: false, error: 'month, year and rows are required' })
    }

    await client.query('BEGIN')

    const employeeLookupResult = await client.query('SELECT id, emp_id FROM tbl_employees')
    const employeeLookup = new Map(
      employeeLookupResult.rows.map((employee) => [String(employee.emp_id).trim(), employee.id]),
    )

    let savedCount = 0

    for (const row of rows) {
      const empId = String(
        row.empId ??
          row['Emp ID'] ??
          row.emp_id ??
          row.employeeId ??
          row.employee_id ??
          '',
      ).trim()
      const employeeId = employeeLookup.get(empId)
      if (!employeeId) {
        continue
      }

      const mrateValue =
        row.mRate ??
        row.mrate ??
        row.MRate ??
        row['MRATE'] ??
        row[' MRATE'] ??
        row['M RATE'] ??
        row['Monthly Rate'] ??
        0
      const basicSalaryValue =
        row.basicSalary ??
        row.basic_salary ??
        row['Basic Salary'] ??
        row['BASIC SALARY'] ??
        row['Basic Pay'] ??
        row['Basic'] ??
        0
      const presentDaysValue = row.presentDays ?? row.present_days ?? row.DAYS ?? 0
      const totalDaysValue = row.totalDays ?? row.total_days ?? row.DAYS ?? 0
      const overtimeHoursValue = row.overtimeHours ?? row.overtime_hours ?? row.OT ?? 0
      const calculatedSalaryValue = calculateSalary(
        mrateValue,
        presentDaysValue,
        totalDaysValue,
        overtimeHoursValue,
      )
      const dataValue = row.data ?? row

      await client.query(
        `INSERT INTO tbl_employee_monthly (
          employee_id, month, year, mrate, present_days, total_days, overtime_hours, calculated_salary, advance_amount, salary_data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        ON CONFLICT (employee_id, month, year)
        DO UPDATE SET
          mrate = EXCLUDED.mrate,
          present_days = EXCLUDED.present_days,
          total_days = EXCLUDED.total_days,
          overtime_hours = EXCLUDED.overtime_hours,
          calculated_salary = EXCLUDED.calculated_salary,
          advance_amount = COALESCE(tbl_employee_monthly.advance_amount, EXCLUDED.advance_amount),
          salary_data = EXCLUDED.salary_data,
          updated_at = now()`,
        [
          employeeId,
          monthNumber,
          yearNumber,
          mrateValue || 0,
          presentDaysValue || 0,
          totalDaysValue || 0,
          overtimeHoursValue || 0,
          calculatedSalaryValue || 0,
          Number(row.advanceAmount || row.advance_amount || 0),
          dataValue || null,
        ],
        )
      savedCount += 1
    }

    await client.query('COMMIT')
    return res.json({ ok: true, count: savedCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('salary breakup upsert error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.get('/api/salary-breakups', async (req, res) => {
  try {
    const { month, year } = req.query
    const monthNumber = Number(month)
    const yearNumber = Number(year)

    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year query params are required' })
    }

    const result = await db.query(
      `SELECT sb.employee_id,
              sb.month,
              sb.year,
              e.mrate AS "mrate",
              e.mrate AS "masterMRate",
              e.basic_package AS "basicPackage",
              sb.present_days,
              sb.total_days,
              sb.overtime_hours,
              COALESCE(adv.advance, 0) AS advance_amount,
              sb.salary_data AS data,
              e.sno,
              e.emp_id AS "empId",
              e.employee_name AS "employeeName",
              e.company,
              e.father_name AS "fatherName",
              e.department,
              e.esi_value AS "esiValue",
              e.tds_value AS "tdsValue"
       FROM tbl_employee_monthly sb
       JOIN tbl_employees e ON e.id = sb.employee_id
       LEFT JOIN tbl_advances adv
         ON adv.employee_id = e.id
        AND adv.month = sb.month
        AND adv.year = sb.year
       WHERE sb.month = $1 AND sb.year = $2
       ORDER BY e.sno, e.id`,
      [monthNumber, yearNumber],
    )

    return res.json({ ok: true, month: monthNumber, year: yearNumber, rows: result.rows })
  } catch (err) {
    console.error('salary breakup fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/salary-breakups/advance', async (req, res) => {
  try {
    const { employeeId, month, year, addAdvanceAmount } = req.body
    const employee = Number(employeeId)
    const monthNumber = Number(month)
    const yearNumber = Number(year)
    const requestedAdvance = Number(addAdvanceAmount) || 0

    if (!employee || !monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'employeeId, month and year are required' })
    }

    const existing = await db.query(
      `SELECT calculated_salary, present_days, total_days, overtime_hours
       FROM tbl_employee_monthly
       WHERE employee_id = $1 AND month = $2 AND year = $3
       LIMIT 1`,
      [employee, monthNumber, yearNumber],
    )

    const existingRow = existing.rows[0]
    const calculatedSalary = existingRow ? resolveSalaryBreakupSalary(existingRow) : 0
    const currentAdvanceResult = await db.query(
      `SELECT COALESCE(advance, 0) AS advance
       FROM tbl_advances
       WHERE employee_id = $1 AND month = $2 AND year = $3
       LIMIT 1`,
      [employee, monthNumber, yearNumber],
    )
    const currentAdvance = Number(currentAdvanceResult.rows[0]?.advance || 0)
    const cappedAdvance = calculatedSalary > 0
      ? Math.max(0, Math.min(currentAdvance + requestedAdvance, calculatedSalary))
      : Math.max(0, currentAdvance + requestedAdvance)

    await db.query(
      `INSERT INTO tbl_advances (
        employee_id, month, year, advance, updated_at
      )
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (employee_id, month, year)
      DO UPDATE SET
        advance = EXCLUDED.advance,
        updated_at = now()`,
      [employee, monthNumber, yearNumber, cappedAdvance],
    )

    return res.json({ ok: true, advanceAmount: cappedAdvance })
  } catch (err) {
    console.error('salary breakup advance update error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/advances/import', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { month, year, rows } = req.body
    const monthNumber = Number(month)
    const yearNumber = Number(year)
    if (!monthNumber || monthNumber < 1 || monthNumber > 12 || !yearNumber || !Array.isArray(rows)) {
      return res.status(400).json({ ok: false, error: 'month, year and rows are required' })
    }
    await client.query('BEGIN')
    let updatedCount = 0
    let skippedCount = 0
    for (const row of rows) {
      const empId = String(row.empId || row.EmpID || '').trim()
      const advanceAmount = Number(row.advance ?? row.Advance ?? 0)
      if (!empId || !Number.isFinite(advanceAmount) || advanceAmount < 0) {
        skippedCount += 1
        continue
      }
      const employeeResult = await client.query(
        `SELECT id FROM tbl_employees WHERE emp_id = $1 LIMIT 1`,
        [empId],
      )
      const employeeId = employeeResult.rows[0]?.id
      if (!employeeId) {
        skippedCount += 1
        continue
      }
      const result = await client.query(
        `INSERT INTO tbl_advances (employee_id, month, year, advance, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (employee_id, month, year)
         DO UPDATE SET advance = EXCLUDED.advance,
                       updated_at = now()`,
        [employeeId, monthNumber, yearNumber, advanceAmount],
      )
      if (result.rowCount) updatedCount += result.rowCount
      else skippedCount += 1
    }
    await client.query('COMMIT')
    return res.json({ ok: true, month: monthNumber, year: yearNumber, updatedCount, skippedCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('advances import error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.get('/api/advances', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ ok: false, error: 'Authentication required.' })
    }

    const monthNumber = Number(req.query.month)
    const yearNumber = Number(req.query.year)
    if (!monthNumber || monthNumber < 1 || monthNumber > 12 || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year are required' })
    }

    const result = await db.query(
      `SELECT a.id,
              a.employee_id,
              e.emp_id AS "empId",
              e.employee_name AS "employeeName",
              e.father_name AS "fatherName",
              e.department,
              COALESCE(a.advance, 0) AS advance
       FROM tbl_advances a
       JOIN tbl_employees e ON e.id = a.employee_id
       WHERE a.month = $1 AND a.year = $2
       ORDER BY e.sno, e.emp_id`,
      [monthNumber, yearNumber],
    )

    return res.json({ ok: true, rows: result.rows })
  } catch (err) {
    console.error('advances fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/salary-breakups/finalization-status', async (req, res) => {
  try {
    const { month, year } = req.query
    const monthNumber = Number(month)
    const yearNumber = Number(year)

    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year query params are required' })
    }

    const result = await db.query(
      `SELECT month, year, finalized_at, is_locked
       FROM tbl_salary_finalizations
       WHERE month = $1 AND year = $2
       LIMIT 1`,
      [monthNumber, yearNumber],
    )

    return res.json({ ok: true, finalized: result.rows[0] || null })
  } catch (err) {
    console.error('salary finalization status error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/government-salaries', async (req, res) => {
  try {
    const monthNumber = Number(req.query.month)
    const yearNumber = Number(req.query.year)
    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year query params are required' })
    }

    const result = await db.query(
      `SELECT
              COALESCE(g.id, f.id) AS id,
              e.id AS employee_id,
              e.sno,
              e.emp_id AS "empId",
              e.employee_name AS "employeeName",
              e.father_name AS "fatherName",
              e.company,
              e.department,
              e.esi_value AS "esiValue",
              e.tds_value AS "tdsValue",
              COALESCE(g.source_present_days, f.present_days, 0) AS source_present_days,
              COALESCE(g.present_days, f.present_days, 0) AS present_days,
              COALESCE(g.total_days, 31) AS total_days,
              COALESCE(g.additional_absent_days, 0) AS additional_absent_days,
              COALESCE(g.source_basic_salary, e.basic_package, NULLIF((e.import_data ->> 'basicPackage')::numeric, 0), 0) AS "sourceBasicSalary",
              COALESCE(g.final_salary, 0) AS final_salary,
              0 AS basic_salary,
              0 AS updated_basic_salary,
              0 AS remaining_balance,
              0 AS hra,
              0 AS ta,
              0 AS washing_allowance,
              0 AS conveyance,
              0 AS ot_allowance,
              0 AS incentive,
              0 AS total_earnings,
              CASE
                WHEN NULLIF(regexp_replace(COALESCE(e.pf_value, ''), '[^0-9.-]', '', 'g'), '')::numeric < 100
                  THEN ROUND((COALESCE(g.source_basic_salary, e.basic_package, 0) * COALESCE(g.present_days, f.present_days, 0) / GREATEST(COALESCE(g.total_days, 31), 1) * 0.65) * NULLIF(regexp_replace(COALESCE(e.pf_value, ''), '[^0-9.-]', '', 'g'), '')::numeric / 100, 2)
                ELSE COALESCE(NULLIF(regexp_replace(COALESCE(e.pf_value, ''), '[^0-9.-]', '', 'g'), '')::numeric, 0)
              END AS pf,
              CASE
                WHEN NULLIF(regexp_replace(COALESCE(e.pfvol_value, ''), '[^0-9.-]', '', 'g'), '')::numeric < 100
                  THEN ROUND((COALESCE(g.source_basic_salary, e.basic_package, 0) * COALESCE(g.present_days, f.present_days, 0) / GREATEST(COALESCE(g.total_days, 31), 1) * 0.65) * NULLIF(regexp_replace(COALESCE(e.pfvol_value, ''), '[^0-9.-]', '', 'g'), '')::numeric / 100, 2)
                ELSE COALESCE(NULLIF(regexp_replace(COALESCE(e.pfvol_value, ''), '[^0-9.-]', '', 'g'), '')::numeric, 0)
              END AS pfvol,
              CASE
                WHEN LOWER(TRIM(COALESCE(e.esi_value, ''))) IN ('yes', 'y', 'true', '1')
                  THEN ROUND((COALESCE(g.source_basic_salary, e.basic_package, 0) * COALESCE(g.present_days, f.present_days, 0) / GREATEST(COALESCE(g.total_days, 31), 1) * 0.65) * 0.0075, 2)
                ELSE 0
              END AS esi,
              CASE
                WHEN NULLIF(regexp_replace(COALESCE(e.tds_value, ''), '[^0-9.-]', '', 'g'), '')::numeric < 100
                  THEN ROUND((COALESCE(g.source_basic_salary, e.basic_package, 0) * COALESCE(g.present_days, f.present_days, 0) / GREATEST(COALESCE(g.total_days, 31), 1) * 0.65) * NULLIF(regexp_replace(COALESCE(e.tds_value, ''), '[^0-9.-]', '', 'g'), '')::numeric / 100, 2)
                ELSE COALESCE(NULLIF(regexp_replace(COALESCE(e.tds_value, ''), '[^0-9.-]', '', 'g'), '')::numeric, 0)
              END AS tds,
              COALESCE(adv.advance, 0) AS advance_amount,
              0 AS other_deduction,
              5 AS plwf,
              0 AS other_deductions,
              CASE
                WHEN NULLIF(regexp_replace(COALESCE(e.prof_tax_value, ''), '[^0-9.-]', '', 'g'), '')::numeric < 100
                  THEN ROUND((COALESCE(g.source_basic_salary, e.basic_package, 0) * COALESCE(g.present_days, f.present_days, 0) / GREATEST(COALESCE(g.total_days, 31), 1) * 0.65) * NULLIF(regexp_replace(COALESCE(e.prof_tax_value, ''), '[^0-9.-]', '', 'g'), '')::numeric / 100, 2)
                ELSE COALESCE(NULLIF(regexp_replace(COALESCE(e.prof_tax_value, ''), '[^0-9.-]', '', 'g'), '')::numeric, 0)
              END AS professional_tax,
              0 AS total_deductions,
              COALESCE(f.final_amount, 0) AS net_amount,
              COALESCE(f.final_amount, 0) AS saved_final_amount
       FROM tbl_finalized_salary_records f
       JOIN tbl_employees e
         ON e.id = f.employee_id
       LEFT JOIN tbl_government_salary_records g
         ON g.employee_id = f.employee_id AND g.month = f.month AND g.year = f.year
       LEFT JOIN tbl_advances adv
         ON adv.employee_id = e.id AND adv.month = f.month AND adv.year = f.year
       WHERE f.month = $1 AND f.year = $2
       ORDER BY e.sno, e.id`,
      [monthNumber, yearNumber],
    )
    return res.json({ ok: true, rows: result.rows })
  } catch (err) {
    console.error('government salary fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/hr/attendance/month-status', async (req, res) => {
  try {
    const { month, year } = req.query
    const monthNumber = Number(month)
    const yearNumber = Number(year)

    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year query params are required' })
    }

    const allDates = getMonthDayList(monthNumber, yearNumber)
    const attendanceCountResult = await db.query(
      `SELECT COUNT(*)::int AS attendance_count
       FROM tbl_employee_monthly
       WHERE month = $1
         AND year = $2`,
      [monthNumber, yearNumber],
    )
    const detailedCountResult = await db.query(
      `SELECT COUNT(*)::int AS detailed_count
       FROM tbl_employee_monthly
       WHERE month = $1
         AND year = $2
         AND (present_days IS NOT NULL OR overtime_hours IS NOT NULL)
         AND (present_days > 0 OR overtime_hours > 0)`,
      [monthNumber, yearNumber],
    )
    const attendanceCount = Number(detailedCountResult.rows[0]?.detailed_count || 0)
    const hasAttendanceData = attendanceCount > 0
    const savedDateList = hasAttendanceData ? allDates : []
    const missingDates = hasAttendanceData ? [] : allDates

    return res.json({
      ok: true,
      month: monthNumber,
      year: yearNumber,
      totalDays: allDates.length,
      attendanceCount,
      hasAttendanceData,
      savedDates: savedDateList,
      savedCount: savedDateList.length,
      missingCount: missingDates.length,
      missingDates,
      isComplete: hasAttendanceData,
    })
  } catch (err) {
    console.error('attendance month status error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/salary-breakups/finalize', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { month, year, finalizedBy } = req.body
    const monthNumber = Number(month)
    const yearNumber = Number(year)

    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year are required' })
    }

    if (isProtectedFinalizationMonth(monthNumber, yearNumber)) {
      return res.status(400).json({ ok: false, error: 'March 2026 cannot be finalized in this software.' })
    }

    const attendanceCountResult = await client.query(
      `SELECT COUNT(*)::int AS attendance_count
       FROM tbl_employee_monthly
       WHERE month = $1
         AND year = $2`,
      [monthNumber, yearNumber],
    )
    const detailedCountResult = await client.query(
      `SELECT COUNT(*)::int AS detailed_count
       FROM tbl_employee_monthly
       WHERE month = $1
         AND year = $2
         AND (present_days IS NOT NULL OR overtime_hours IS NOT NULL)
         AND (present_days > 0 OR overtime_hours > 0)`,
      [monthNumber, yearNumber],
    )
    const attendanceCount = Number(detailedCountResult.rows[0]?.detailed_count || 0)
    if (!attendanceCount) {
      return res.status(400).json({
        ok: false,
        error: 'Please upload the Attendance file first.',
      })
    }

    const salaryBreakupCoverage = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tbl_employees WHERE is_active = TRUE) AS active_employee_count,
         (SELECT COUNT(*)::int
          FROM tbl_employee_monthly sb
          JOIN tbl_employees e ON e.id = sb.employee_id
          WHERE sb.month = $1 AND sb.year = $2 AND e.is_active = TRUE) AS salary_breakup_count`,
      [monthNumber, yearNumber],
    )
    const coverage = salaryBreakupCoverage.rows[0]
    if (Number(coverage.salary_breakup_count) !== Number(coverage.active_employee_count)) {
      return res.status(400).json({
        ok: false,
        error: `Upload/import Salary Breakups for ${getMonthLabel(monthNumber, yearNumber)} first.`,
        activeEmployeeCount: Number(coverage.active_employee_count),
        salaryBreakupCount: Number(coverage.salary_breakup_count),
      })
    }

    await client.query('BEGIN')
    const payrollResult = await client.query(
      `SELECT e.id AS employee_id,
              e.sno,
              e.emp_id,
              e.employee_name,
              e.father_name,
              COALESCE(e.mrate, 0) AS mrate,
              COALESCE(NULLIF(e.basic_package, 0), 0) AS basic_salary,
              COALESCE(adv.advance, 0) AS advance_amount,
              e.pf_value AS employee_pf_value,
              e.pfvol_value AS employee_pfvol_value,
              e.esi_value AS employee_esi_value,
              e.tds_value AS employee_tds_value,
              e.prof_tax_value AS employee_prof_tax_value,
              sb.salary_data AS data,
              COALESCE(sb.present_days, 0) AS present_days,
              COALESCE(sb.overtime_hours, 0) AS overtime_hours
      FROM tbl_employees e
      JOIN tbl_employee_monthly sb
         ON sb.employee_id = e.id AND sb.month = $1 AND sb.year = $2
      LEFT JOIN tbl_advances adv
         ON adv.employee_id = e.id AND adv.month = $1 AND adv.year = $2
      WHERE e.is_active = TRUE
      GROUP BY e.id, e.sno, e.emp_id, e.employee_name, e.father_name,
                sb.id, e.mrate, e.basic_package, sb.salary_data, sb.present_days, sb.overtime_hours, adv.advance
      ORDER BY e.sno, e.id`,
      [monthNumber, yearNumber],
    )

    const allDates = getMonthDayList(monthNumber, yearNumber)
    const totalDays = allDates.length
    const governmentRows = payrollResult.rows.map((row) => {
      const presentDays = Number(row.present_days || 0)
      const overtimeHours = Number(row.overtime_hours || 0)
      const mrate = Number(row.mrate || 0)
      const basicSalary = Number(row.basic_salary || 0)
      const daysAmount = roundMoney(mrate * (presentDays / totalDays))
      const otAmount = roundMoney(mrate * (overtimeHours / (8 * totalDays)))
      const totalEarnings = roundMoney(daysAmount + otAmount)
      const derivedBasicSalary = roundMoney((basicSalary * (presentDays / totalDays)) * 0.65)
      const pf = resolvePfDeduction(row.employee_pf_value, basicSalary)
      const pfvol = resolveMasterDeduction(row.employee_pfvol_value, basicSalary)
      const esi = normalizeYesNo(row.employee_esi_value)
        ? roundMoney(derivedBasicSalary * 0.0075)
        : 0
      const deductions = {
        pf,
        pfvol,
        esi,
        tds: resolveMasterDeduction(row.employee_tds_value, basicSalary),
        advanceAmount: roundMoney(row.advance_amount),
        plwf: 5,
        otherDeductions: 0,
        professionalTax: resolveMasterDeduction(row.employee_prof_tax_value, basicSalary),
      }
      const finalAmount = Math.round(totalEarnings - (
        roundMoney(deductions.pf) + roundMoney(deductions.pfvol) + roundMoney(deductions.esi) + roundMoney(deductions.tds) + roundMoney(deductions.advanceAmount) +
        roundMoney(deductions.plwf) + roundMoney(deductions.otherDeductions) + roundMoney(deductions.professionalTax)
      ))
      const governmentSalary = calculateGovernmentSalary({
        sourceBasicSalary: basicSalary,
        presentDays,
        totalDays,
        deductions,
        esiEnabled: normalizeYesNo(row.employee_esi_value),
        targetFinalAmount: finalAmount,
      })
      return {
        employeeId: row.employee_id,
        presentDays,
        finalAmount,
        governmentSalary,
      }
    })

    for (const row of governmentRows) {
      await client.query(
        `INSERT INTO tbl_finalized_salary_records (employee_id, month, year, present_days, final_amount, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (employee_id, month, year)
         DO UPDATE SET present_days = EXCLUDED.present_days, final_amount = EXCLUDED.final_amount, updated_at = now()`,
        [row.employeeId, monthNumber, yearNumber, row.presentDays, row.finalAmount],
      )
    }

    await client.query('DELETE FROM tbl_government_salary_records WHERE month = $1 AND year = $2', [monthNumber, yearNumber])
    for (const row of governmentRows) {
      const government = row.governmentSalary
      await client.query(
        `INSERT INTO tbl_government_salary_records (
          employee_id, month, year, source_present_days, present_days, total_days, additional_absent_days,
          final_amount, saved_final_amount, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, now()
        )`,
        [
          row.employeeId,
          monthNumber,
          yearNumber,
          government.sourcePresentDays,
          government.presentDays,
          totalDays,
          government.additionalAbsentDays,
          row.finalAmount,
          row.finalAmount,
        ],
      )
    }

    await client.query(
      `INSERT INTO tbl_salary_finalizations (month, year, finalized_by, is_locked, finalized_at)
       VALUES ($1, $2, $3, TRUE, now())
       ON CONFLICT (month, year)
       DO UPDATE SET
         finalized_by = EXCLUDED.finalized_by,
         is_locked = TRUE,
         finalized_at = now()`,
      [monthNumber, yearNumber, finalizedBy ? Number(finalizedBy) : null],
    )

    await client.query('COMMIT')
    return res.json({ ok: true, count: governmentRows.length })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('salary finalization error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.get('/api/hr/employees', async (req, res) => {
  try {
    const monthNumber = Number(req.query.month)
    const yearNumber = Number(req.query.year)
    const queryText = `SELECT e.id,
              e.sno,
              e.emp_id AS "empId",
              e.employee_name AS "employeeName",
              e.father_name AS "fatherName",
              e.department,
              e.company,
              e.is_active AS "is_active",
              e.mrate AS "masterMRate",
              e.basic_package AS "basicPackage",
              e.pf_value AS "pfValue",
              e.pfvol_value AS "pfvolValue",
              e.esi_value AS "esiValue",
              e.tds_value AS "tdsValue",
              e.prof_tax_value AS "profTaxValue",
              e.import_data AS "importData",
              e.mrate AS "monthlyMRate",
              COALESCE(NULLIF(e.basic_package, 0), 0) AS "basicSalary",
              COALESCE(sb.present_days, 0) AS "presentDays",
              COALESCE(sb.total_days, 0) AS "totalDays",
              COALESCE(sb.overtime_hours, 0) AS "overtimeHours",
              0 AS "calculatedSalary"
       FROM tbl_employees e
       LEFT JOIN tbl_employee_monthly sb
         ON sb.employee_id = e.id
        ${monthNumber && yearNumber ? 'AND sb.month = $1 AND sb.year = $2' : ''}
       ORDER BY sno, id`
    const result = await db.query(queryText, monthNumber && yearNumber ? [monthNumber, yearNumber] : [])
    return res.json({
      ok: true,
      month: monthNumber || null,
      year: yearNumber || null,
      employees: result.rows,
    })
  } catch (err) {
    console.error('employees fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/hr/employees', async (req, res) => {
  try {
    const { sno, empId, employeeName, fatherName, department, company } = req.body
    if (!employeeName || !fatherName || !department) {
      return res.status(400).json({ ok: false, error: 'employeeName, fatherName and department are required' })
    }

    const resolvedEmpId = empId || `KE-${Date.now()}`
    const result = await db.query(
      `INSERT INTO tbl_employees (sno, emp_id, employee_name, father_name, department, company)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [Number(sno) || 1, resolvedEmpId, employeeName, fatherName, department, company || null],
    )

    return res.json({ ok: true, id: result.rows[0]?.id })
  } catch (err) {
    console.error('employee insert error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/hr/employees/import', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { employees, sourceFileName, payrollMonth, payrollYear } = req.body
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ ok: false, error: 'employees array is required' })
    }

    const parseNum = (value) => {
      const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
      return normalized === '' ? 0 : Number(normalized) || 0
    }

    const splitBasicPackage = (basicPackage) => {
      const totalBasic = roundMoney(parseNum(basicPackage))
      const basicSalary = roundMoney(totalBasic * 0.65)
      const remainingBalance = roundMoney(totalBasic - basicSalary)
      const hra = roundMoney(remainingBalance * 0.66)
      const ta = roundMoney(remainingBalance * 0.22)
      const washingAllowance = roundMoney(remainingBalance * 0.12)
      return { totalBasic, basicSalary, remainingBalance, hra, ta, washingAllowance }
    }

    const normalizeDeductionRule = (value) => {
      const text = String(value ?? '').trim()
      if (!text) return { raw: '', type: 'fixed', amount: 0 }
      if (text.endsWith('%')) return { raw: text, type: 'percentage', amount: parseNum(text) }
      return { raw: text, type: 'fixed', amount: parseNum(text) }
    }

    const filePeriod = parsePayrollPeriodFromFileName(sourceFileName)
    const currentMonth = new Date().getMonth() + 1
    const currentYear = new Date().getFullYear()
    const resolvedMonth = Number(payrollMonth) || filePeriod?.month || currentMonth
    const resolvedYear = Number(payrollYear) || filePeriod?.year || currentYear

    await client.query('BEGIN')

    let savedCount = 0
    const errors = []

    for (const employee of employees) {
      const sno = Number(employee.sno) || 1
      const empId = String(employee.empId || '').trim()
      const employeeName = String(employee.employeeName || '').trim()
      const fatherName = String(employee.fatherName || '').trim()
      const department = String(employee.department || '').trim()
      const company = String(employee.company || '').trim()
      const mrate = parseNum(employee.mrate ?? employee.mRate)
      const basicPackage = parseNum(employee.basic ?? employee.basicSalary ?? employee.BASIC)
      const deductions = {
        pf: normalizeDeductionRule(employee.pf),
        pfvol: normalizeDeductionRule(employee.pfvol ?? employee.pfVol),
        esi: normalizeDeductionRule(employee.esi),
        tds: normalizeDeductionRule(employee.tds),
        profTax: normalizeDeductionRule(employee.profTax ?? employee['PROF.TAX']),
      }
      const split = splitBasicPackage(basicPackage)
      const employeeResult = await client.query(
        `INSERT INTO tbl_employees (
          sno, emp_id, employee_name, father_name, department, is_active,
          company, mrate, basic_package, pf_value, pfvol_value, esi_value, tds_value, prof_tax_value, import_data
        )
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (emp_id)
         DO UPDATE SET
           sno = EXCLUDED.sno,
           employee_name = EXCLUDED.employee_name,
           father_name = EXCLUDED.father_name,
           department = EXCLUDED.department,
           company = EXCLUDED.company,
           mrate = EXCLUDED.mrate,
           basic_package = EXCLUDED.basic_package,
           pf_value = EXCLUDED.pf_value,
           pfvol_value = EXCLUDED.pfvol_value,
           esi_value = EXCLUDED.esi_value,
           tds_value = EXCLUDED.tds_value,
           prof_tax_value = EXCLUDED.prof_tax_value,
           import_data = EXCLUDED.import_data,
           is_active = TRUE,
           updated_at = now()
         RETURNING id`,
        [
          sno,
          empId || `KE-${Date.now()}`,
          employeeName,
          fatherName,
          department,
          company,
          mrate,
          basicPackage,
          deductions.pf.raw,
          deductions.pfvol.raw,
          deductions.esi.raw,
          deductions.tds.raw,
          deductions.profTax.raw,
          JSON.stringify({
            source: 'master-upload',
            sno,
            empId: empId || `KE-${Date.now()}`,
            employeeName,
            fatherName,
            department,
            company,
            mrate,
            basicPackage,
            deductions,
          }),
        ],
      )

      savedCount += 1
    }

    if (errors.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ ok: false, error: errors[0], errors })
    }

    await client.query('COMMIT')
    return res.json({ ok: true, count: savedCount, payrollMonth: resolvedMonth, payrollYear: resolvedYear })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('employee import error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.patch('/api/hr/employees/:id/esi', async (req, res) => {
  try {
    const employeeId = Number(req.params.id)
    const esi = normalizeYesNo(req.body?.esi)
    if (!employeeId) {
      return res.status(400).json({ ok: false, error: 'employeeId is required' })
    }

    const result = await db.query(
      `UPDATE tbl_employees
       SET esi_value = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, esi_value`,
      [employeeId, esi],
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Employee not found' })
    }

    return res.json({ ok: true, employee: result.rows[0] })
  } catch (err) {
    console.error('update employee esi error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.patch('/api/hr/employees/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params
    const result = await db.query(
      `UPDATE tbl_employees
       SET is_active = NOT is_active, updated_at = now()
       WHERE id = $1
       RETURNING id, is_active`,
      [id],
    )

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Employee not found' })
    }

    return res.json({ ok: true, employee: result.rows[0] })
  } catch (err) {
    console.error('toggle employee error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/reports/direct-salary/import', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { rows } = req.body
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'rows array is required' })
    }

    const parseNum = (value) => {
      const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
      return normalized === '' ? 0 : Number(normalized) || 0
    }

    const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100

    await client.query('BEGIN')
    let savedCount = 0
    for (const row of rows) {
      const empId = String(row.empId ?? row['EmpID'] ?? row['Emp ID'] ?? '').trim()
      const employeeName = String(row.employeeName ?? row['Employee Name'] ?? '').trim()
      const fatherName = String(row.fatherName ?? row["Father's Name"] ?? '').trim()
      const department = String(row.department ?? row.Department ?? '').trim()
      const importedBasicSalary = parseNum(row.basicSalary ?? row['Basic Salary'])
      const presentDays = parseNum(row.presentDays ?? row['Present Days'])
      const totalDays = Math.max(0, parseNum(row.totalDays ?? row['Total Days']))
      const pf = parseNum(row.pf ?? row.PF)
      const pfvol = parseNum(row.pfvol ?? row.PFVOL)
      const esiImported = parseNum(row.esi ?? row.ESI)
      const tds = parseNum(row.tds ?? row.TDS)
      const advance = parseNum(row.advance ?? row.Advance)
      const plwf = parseNum(row.plwf ?? row.PLWF)
      const profTax = parseNum(row.profTax ?? row['PROF. TAX'] ?? row.prof_tax)

      const sourceBasicSalary = round2(importedBasicSalary)
      const basicSalary = round2(sourceBasicSalary * (presentDays / Math.max(1, totalDays)))
      const hra = round2(basicSalary * 0.066666667)
      const conveyance = round2(basicSalary * 0.266666667)
      const esi = esiImported > 0 ? round2(basicSalary * 0.0075) : 0
      const targetNetAmount = round2(parseNum(row.netAmount ?? row['Net Amount']))
      const baseEarnings = round2(basicSalary + hra + conveyance)
      const baseDeductions = round2(pf + pfvol + esi + tds + advance + plwf + profTax)
      let otAllowance = 0
      let incentives = 0
      let otherDeductions = 0
      let totalEarnings = round2(baseEarnings)
      let totalDeductions = round2(baseDeductions)
      let netAmount = targetNetAmount
      const diff = round2(targetNetAmount - round2(totalEarnings - totalDeductions))

      if (diff > 0) {
        otAllowance = Math.min(diff, 350)
        incentives = round2(Math.max(0, diff - otAllowance))
        totalEarnings = round2(baseEarnings + otAllowance + incentives)
        netAmount = round2(totalEarnings - totalDeductions)
      } else if (diff < 0) {
        otherDeductions = Math.abs(diff)
        totalDeductions = round2(baseDeductions + otherDeductions)
      }

      await client.query(
        `INSERT INTO tbl_persons (
          emp_id, employee_name, father_name, department, basic_salary, present_days, total_days,
          pf, pfvol, esi, tds, advance, plwf, prof_tax, net_amount, import_data, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
        ON CONFLICT (emp_id)
        DO UPDATE SET
          employee_name = EXCLUDED.employee_name,
          father_name = EXCLUDED.father_name,
          department = EXCLUDED.department,
          basic_salary = EXCLUDED.basic_salary,
          present_days = EXCLUDED.present_days,
          total_days = EXCLUDED.total_days,
          pf = EXCLUDED.pf,
          pfvol = EXCLUDED.pfvol,
          esi = EXCLUDED.esi,
          tds = EXCLUDED.tds,
          advance = EXCLUDED.advance,
          plwf = EXCLUDED.plwf,
          prof_tax = EXCLUDED.prof_tax,
          net_amount = EXCLUDED.net_amount,
          import_data = EXCLUDED.import_data,
          updated_at = now()`,
        [
          empId || `KE-${Date.now()}`,
          employeeName,
          fatherName,
          department,
          sourceBasicSalary,
          presentDays,
          totalDays,
          pf,
          pfvol,
          esi,
          tds,
          advance,
          plwf,
          profTax,
          targetNetAmount,
          JSON.stringify({
            importedBasicSalary,
            sourceBasicSalary,
            presentDays,
            totalDays,
            hra,
            conveyance,
            otAllowance,
            incentives,
            otherDeductions,
            targetNetAmount,
          }),
        ],
      )
      savedCount += 1
    }

    await client.query('COMMIT')
    return res.json({ ok: true, count: savedCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('direct salary import error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.get('/api/reports/direct-salary', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM tbl_persons
       ORDER BY created_at DESC, id DESC`,
    )
    return res.json({ ok: true, rows: result.rows })
  } catch (err) {
    console.error('direct salary fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.delete('/api/reports/direct-salary', async (_req, res) => {
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM tbl_persons')
    await client.query('COMMIT')
    return res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('direct salary reset error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

﻿app.post('/api/hr/employees/:id/increment', async (req, res) => {
  try {
    const employeeId = Number(req.params.id)
    const { incrementType, incrementValue, effectiveMonth, effectiveYear } = req.body
    if (!employeeId || !['fixed', 'percentage'].includes(String(incrementType))) {
      return res.status(400).json({ ok: false, error: 'employeeId and incrementType are required' })
    }

    const increment = Number(incrementValue)
    const month = Number(effectiveMonth)
    const year = Number(effectiveYear)
    if (!Number.isFinite(increment) || !month || !year) {
      return res.status(400).json({ ok: false, error: 'incrementValue, effectiveMonth and effectiveYear are required' })
    }

    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO tbl_salary_increment_history (employee_id, increment_type, increment_value, effective_month, effective_year)
         VALUES ($1, $2, $3, $4, $5)`,
        [employeeId, incrementType, increment, month, year],
      )

      await client.query(
        `UPDATE tbl_employees
         SET basic_package = ROUND(CASE
               WHEN $2 = 'percentage' THEN COALESCE(basic_package, 0) + (COALESCE(basic_package, 0) * $3 / 100)
               ELSE COALESCE(basic_package, 0) + $3
             END, 2),
             mrate = ROUND(CASE
               WHEN $2 = 'percentage' THEN COALESCE(mrate, 0) + (COALESCE(mrate, 0) * $3 / 100)
               ELSE COALESCE(mrate, 0) + $3
             END, 2),
             updated_at = now()
         WHERE id = $1`,
        [employeeId, incrementType, increment],
      )

      await client.query(
        `UPDATE tbl_employee_monthly monthly
         SET basic_salary = CASE
           WHEN $2 = 'percentage' THEN ROUND(monthly.basic_salary + (monthly.basic_salary * $3 / 100), 2)
           ELSE ROUND(monthly.basic_salary + $3, 2)
         END,
         total_basic_package = CASE
           WHEN $2 = 'percentage' THEN ROUND(monthly.total_basic_package + (monthly.total_basic_package * $3 / 100), 2)
           ELSE ROUND(monthly.total_basic_package + $3, 2)
         END,
         updated_at = now()
         WHERE monthly.employee_id = $1
           AND (monthly.year > $4 OR (monthly.year = $4 AND monthly.month >= $5))
           AND NOT EXISTS (
             SELECT 1 FROM tbl_salary_finalizations f
             WHERE f.month = monthly.month AND f.year = monthly.year AND f.is_locked = TRUE
           )`,
        [employeeId, incrementType, increment, year, month],
      )

      await client.query('COMMIT')
      return res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('employee increment error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/hr/attendance', async (req, res) => {
  try {
    const { date } = req.query
    if (!date) {
      return res.status(400).json({ ok: false, error: 'date query param required' })
    }

    const selectedDate = new Date(`${date}T00:00:00`)
    if (Number.isNaN(selectedDate.getTime())) {
      return res.status(400).json({ ok: false, error: 'date query param is invalid' })
    }
    const monthNumber = selectedDate.getMonth() + 1
    const yearNumber = selectedDate.getFullYear()

    const result = await db.query(
      `SELECT a.monthly_employee_id,
              m.employee_id,
              a.attendance_status,
              a.overtime_hours,
              a.leave_category
       FROM tbl_employee_attendance a
       JOIN tbl_employee_monthly m ON m.id = a.monthly_employee_id
       WHERE a.attendance_date = $1
         AND m.month = $2
         AND m.year = $3`,
      [date, monthNumber, yearNumber],
    )

    return res.json({ ok: true, attendance: result.rows })
  } catch (err) {
    console.error('attendance fetch error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.get('/api/hr/attendance/summary', async (req, res) => {
  try {
    const { month, year, throughDate } = req.query
    const monthNumber = Number(month)
    const yearNumber = Number(year)
    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'month and year query params are required' })
    }

    const result = await db.query(
      `SELECT e.id AS employee_id,
              COALESCE(m.present_days, 0) AS present_days,
              COALESCE(m.overtime_hours, 0) AS overtime_hours
       FROM tbl_employees e
       LEFT JOIN tbl_employee_monthly m
        ON m.employee_id = e.id
       AND m.month = $1
       AND m.year = $2
       ORDER BY e.id`,
      [monthNumber, yearNumber],
    )

    return res.json({ ok: true, summary: result.rows })
  } catch (err) {
    console.error('attendance summary error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/hr/attendance/import-monthly', async (req, res) => {
  const client = await db.pool.connect()
  try {
    const { rows, sourceFileName } = req.body
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'rows array is required' })
    }

    const parseNum = (value) => {
      const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '').trim()
      return normalized === '' ? 0 : Number(normalized) || 0
    }

    const periodMatch = String(sourceFileName || '').match(/(\d{2})-(\d{4})/)
    if (!periodMatch) {
      return res.status(400).json({ ok: false, error: 'Unable to resolve payroll month/year from the uploaded file name.' })
    }
    const monthNumber = Number(periodMatch[1])
    const yearNumber = Number(periodMatch[2])
    if (!monthNumber || !yearNumber) {
      return res.status(400).json({ ok: false, error: 'Unable to resolve payroll month/year from the uploaded file name.' })
    }

    const employeesResult = await client.query(
      `SELECT id, emp_id
       FROM tbl_employees
       WHERE is_active = TRUE`,
    )
    const employeeMap = new Map(employeesResult.rows.map((employee) => [String(employee.emp_id).trim(), Number(employee.id)]))

    await client.query('BEGIN')
    let savedCount = 0
    let skippedCount = 0

    for (const row of rows) {
      const empId = String(row.empId ?? row['EmpId'] ?? row['Emp ID'] ?? '').trim()
      const employeeId = employeeMap.get(empId)
      if (!employeeId) {
        skippedCount += 1
        continue
      }

      await client.query(
        `INSERT INTO tbl_employee_monthly (
           employee_id, month, year, total_days, present_days, overtime_hours, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (employee_id, month, year)
         DO UPDATE SET
           total_days = EXCLUDED.total_days,
           present_days = EXCLUDED.present_days,
           overtime_hours = EXCLUDED.overtime_hours,
           updated_at = now()`,
        [
          employeeId,
          monthNumber,
          yearNumber,
          new Date(yearNumber, monthNumber, 0).getDate(),
          parseNum(row.presentDays ?? row['Present Days']),
          parseNum(row.overtimeHours ?? row['OT Hours']),
        ],
      )
      savedCount += 1
    }

    await client.query('COMMIT')
    return res.json({ ok: true, month: monthNumber, year: yearNumber, savedCount, skippedCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('monthly attendance import error', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    client.release()
  }
})

app.get('/api/hr/reports/hr-summary', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.id AS employee_id,
              e.sno,
              e.emp_id AS "empId",
              e.employee_name AS "employeeName",
              e.father_name AS "fatherName",
              e.department,
              COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' THEN 1 ELSE 0 END), 0) AS total_absent_days,
              COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Without Prior Information' THEN 1 ELSE 0 END), 0) AS "withoutPriorInformation",
              COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Leave to be Encashed' THEN 1 ELSE 0 END), 0) AS "leaveToBeEncashed",
              COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Leave by ESI' THEN 1 ELSE 0 END), 0) AS "leaveByEsi",
              GREATEST(
                COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' THEN 1 ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Without Prior Information' THEN 1 ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Leave to be Encashed' THEN 1 ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN a.attendance_status = 'absent' AND a.leave_category = 'Leave by ESI' THEN 1 ELSE 0 END), 0),
                0
              ) AS "weekOffLeave",
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'date', TO_CHAR(a.attendance_date, 'YYYY-MM-DD'),
                    'status', a.attendance_status,
                    'leaveCategory', a.leave_category
                  )
                  ORDER BY a.attendance_date
                ) FILTER (WHERE a.attendance_date IS NOT NULL),
                '[]'::json
              ) AS leave_dates
       FROM tbl_employees e
       LEFT JOIN tbl_employee_monthly m
         ON m.employee_id = e.id
       LEFT JOIN tbl_employee_attendance a
         ON a.monthly_employee_id = m.id
       GROUP BY e.id, e.sno, e.emp_id, e.employee_name, e.father_name, e.department
       ORDER BY e.sno, e.id`,
    )

    return res.json({ ok: true, rows: result.rows })
  } catch (err) {
    console.error('hr summary report error', err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/hr/attendance/batch', async (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Day-wise attendance saves are no longer supported. Use the monthly attendance import instead.',
  })
})

const port = process.env.PORT || 4000
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`KumarExports server listening on ${port}`))
  })
  .catch((err) => {
    console.error('schema initialization error', err)
    process.exit(1)
  })








