# Employee Management System

A full-stack Employee Management System built to simplify employee records and leave management. This project provides separate interfaces for administrators and employees, allowing organizations to manage employee information, leave requests, and authentication through a clean and responsive web application.

The application is built using the MERN stack and follows a REST API architecture for communication between the frontend and backend.

---

## Features

### Admin

* Secure admin authentication using JWT
* Add new employees
* Update employee details
* Delete employees
* View all employees
* Filter employees by department
* Upload and manage employee profile images
* Review leave requests
* Approve or reject leave applications

### Employee

* Secure login
* View personal profile
* Apply for leave
* Track leave request status
* Update profile information

---

## Tech Stack

### Frontend

* React.js
* React Router
* Axios
* CSS

### Backend

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT Authentication
* Multer (Image Uploads)
* bcrypt

---

## Project Structure

```
Employee-Management-System/
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── uploads/
│   └── package.json
│
└── README.md
```

---

## Installation

### Clone the repository

```bash
git clone https://github.com/your-username/FullStack_EMS.git
cd FullStack_EMS
```

### Backend

```bash
cd backend
npm install
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

Create a `.env` file inside the backend directory.

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

---

## API Overview

The backend exposes RESTful APIs for:

* Authentication
* Employee Management
* Leave Management
* Department Filtering
* Image Uploads

---

## Future Improvements

* Dashboard with employee analytics
* Attendance management
* Payroll module
* Email notifications
* Role-based permissions with multiple admin levels
* Search and pagination
* Dark mode

---

## Learning Outcomes

This project helped me gain practical experience with:

* Building REST APIs using Express.js
* Designing MongoDB schemas with Mongoose
* JWT-based authentication and authorization
* File uploads using Multer
* State management and API integration in React
* CRUD operations
* Frontend and backend integration
* Structuring a full-stack MERN application

---

## Author

**Sagar Reddy**

If you found this project helpful or interesting, feel free to give it a ⭐.
