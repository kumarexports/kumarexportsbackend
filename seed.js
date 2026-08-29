require('dotenv').config()
const bcrypt = require('bcryptjs')
const db = require('./db')

async function run() {
  try {
    // run migrations SQL
    const fs = require('fs')
    const path = require('path')
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'init.sql'), 'utf8')
    await db.pool.query(sql)

    // upsert some roles and departments
    const roles = ['Admin', 'HR', 'Employee']
    for (const r of roles) {
      await db.query('INSERT INTO tbl_roles(roleName) VALUES($1) ON CONFLICT (id) DO NOTHING', [r]).catch(()=>{})
    }
    const depts = ['Administration', 'Human Resources', 'Finance']
    for (const d of depts) {
      await db.query('INSERT INTO tbl_departments(departmentName) VALUES($1) ON CONFLICT (id) DO NOTHING', [d]).catch(()=>{})
    }

    // create admin user if not exists
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@kumarexports.com'
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123'

    const hashed = await bcrypt.hash(adminPassword, 10)

    const roleRes = await db.query('SELECT id FROM tbl_roles WHERE roleName=$1 LIMIT 1', ['Admin'])
    const deptRes = await db.query('SELECT id FROM tbl_departments WHERE departmentName=$1 LIMIT 1', ['Administration'])

    const roleId = roleRes.rows[0] ? roleRes.rows[0].id : null
    const departmentId = deptRes.rows[0] ? deptRes.rows[0].id : null

    const exists = await db.query('SELECT id FROM tbl_users WHERE email=$1', [adminEmail])
    if (exists.rows.length === 0) {
      await db.query('INSERT INTO tbl_users(name,email,password,roleId,departmentId) VALUES($1,$2,$3,$4,$5)', [
        'Admin', adminEmail, hashed, roleId, departmentId,
      ])
      console.log('Created admin user:', adminEmail)
    } else {
      console.log('Admin user already exists')
    }

    console.log('Seeding complete')
    process.exit(0)
  } catch (err) {
    console.error('Seed error', err)
    process.exit(1)
  }
}

run()
