const express = require('express');
require('dotenv').config;
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const Student = require('./student.js');
const Record = require('./record.js');
const student = require('./student.js');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = YAML.load('./swagger.yaml'); //Load our Swagger YAML file
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const secretKey = 'my_secret_key';

const app = express();

app.set('view engine','ejs');
app.set('views','./views');

//Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({extended:true}));
app.use(cookieParser());
app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: false,
  }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// create a write stream (in append mode)
var accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
 
// setup the logger
app.use(morgan('combined', { stream: accessLogStream }));


//high level middleware function for JWT authetication
function authenticateToken(req, res, next){

    const token = req.cookies.jwt;

    if(token){

      jwt.verify(token, secretKey, (err, decoded) => {

          if(err){ return res.status(401).send('Invalid Token');}
          req.userId = decoded;
          next();
      })
    }else {
        res.status(401).render('401');
      }
}

//rate limit configuration
const apiLimiter = rateLimit({
    WindowsMS: 1 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false
})

const url = `mongodb+srv://testUser:Password@cluster0.q5sujkp.mongodb.net/`;

mongoose.connect(url)
.then(() =>{
    console.log('Connected to MongoDB Database');
})
.catch((err)=>{
    console.log(`Error connecting to the database: ${err}`)
});

app.get('/',(req,res) => {

   // const email = req.body.email;
   // const password = req.body.password;

    res.render('login');
});


app.post('/', async (req,res) =>{
    const email = req.body.email;
    const password = req.body.password;

    //find user in the database by emamil
    const user = await Student.findOne({email});

    if(!user){
        //user not found
        res.status(404).send('User not found');
        return;
    }

    //creating and signing a JWT
    const unique = user._id.toString();
    
    //storing userId in the session
    req.session.userId = user._id.toString();

    //create a jwt
    const token = jwt.sign(unique, secretKey);
    //stuff the token(jwt) niside the cookie
    res.cookie('jwt', token, {maxAge: 5*60*3000, httpOnly: true});

    bcrypt.compare(password, user.password, (err, result)=> {
        if(result){
            res.redirect('home');
        }else{
            res.send('Password incorrect lol');
        }
    });

    jwt.verify(token, secretKey, (err, decoded) => {
        console.log(token);
        console.log(decoded);
    });
});

app.post('/register',(req,res) => {
    const {email, password, confirmPassword} = req.body;
    const user = Student.findOne({email});

    //check if username already exists
    //if(user){
    //    res.status(400).send('Username already exists. Please try again');
     //   return;
    //}

    //check if the confirmed password equals the password
    if(password !== confirmPassword){
        res.status(400).send('Passwords do not match. Please try again');
        return;
    }

    bcrypt.hash(password, 12, (err, hashedPassword) => {
        const user = new Student({
            email:  email,
            password: hashedPassword,
        });

        user.save();
        res.redirect('/');
    });

});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/addstudent', (req, res) => {
    const student = new Record({
        name: req.body.name,
        email: req.body.email
    });

    student.save();
    res.redirect('/home');
});

app.post('/deletestudent', async (req, res) => {
    const studentName = req.body.name;
    const trimmedName = studentName.trim();

    try{
        const result = await Record.deleteOne({name: trimmedName});

        if(result.deletedCount === 0){
            res.status(404).send('User does not exist. Try again');
        } else {
            res.redirect('/home');
        }

    }catch(error){
        res.status(500).send("An unknown error has occured while deleting student records.");
    }
});



app.get('/home', authenticateToken, async (req, res) => {
    const students = await Record.find({});
    const maxAttendanceCount = Math.max(...students.map(student => student.attendanceCount));

    res.render('attendance',{students, maxAttendanceCount});

});

app.post('/update-student',async (req, res) => {
    const attendanceDate = req.body.attendanceDate;
    const length = req.body.attendance ? req.body.attendance.length: 0;

    try{
        for(let i=0; i < length; i++){
            const studentId = req.body.attendance[i];
            const result = await Record.findByIdAndUpdate(
                studentId,
                {
                    $inc: {attendanceCount: 1},
                    $set: {attendanceDate: new Date(attendanceDate)}
                },
                {new:true},
            );
            
        }
        res.status(200).redirect('/home');
    }catch(err){
        res.status(500).send("An unknown error has occured while updating student records.");
    }

});

app.post('/reset',  async (req, res) => {
    try{
        const students = await Record.find({});

        for(let i=0; i < students.length; i++){
            students[i].attendanceCount = 0;
            await students[i].save();
        }

        res.redirect('/home');

    }catch(error){
        res.status(500).send("An unknown error has occured while updating student records.");

    }
    

});

app.post('/logout', (req, res) => {
    
    res.clearCookie('jwt');
    req.session.userId = null;
    req.session.destroy((err) => {
        if(err){
            res.status(500).send('Internal Server Error');
        }else{
            res.redirect('/');
        }
    });
});

app.get('/api/v2', apiLimiter, async (req, res) => {
  try {
    const records = await Record.find({});
    const formatted = JSON.stringify(records);
    res.send(formatted);
  } catch (error) {
    console.error("Error fetching records:", error);
    res.status(500).send("Error fetching records");
  }
});

app.post('/api/v2', async (req, res) =>{
    try{
        const {name, email} = req.body;

        //create the new student record
        const student = new Record({
            name: name,
            email: email,
        });

        await student.save();
        res.status(200).json({message: 'Student successfully created!', student: student});

    }catch(error){
        res.status(500).json({message: 'Error occurred while adding new student record'});
    }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, ()=>{
    console.log(`Successfully connected to ${PORT}`);
});