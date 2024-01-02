const express = require('express');
const cors = require('cors');
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const jwt= require('jsonwebtoken');
const User= require('./models/User');
const Place=require('./models/place');
const Booking=require('./models/booking');
const cookieParser = require('cookie-parser');
const imageDownloader= require('image-downloader');
const multer = require('multer');
const {S3Client, PutObjectAclCommand, ListBucketsCommand, PutObjectCommand}= require('@aws-sdk/client-s3')
const fs = require('fs');
const mime = require('mime-types')
const { resolve } = require('path');
const { rejects } = require('assert');
const app= express();

const bcryptSalt= bcrypt.genSaltSync(10);
const bucket='booking-app-abdo'
require('dotenv').config();
app.use('/uploads',express.static(__dirname+'/uploads'));
app.use(express.json());
app.use(cookieParser());
app.use(
    cors({ 
            origin:"*" ,
            credentials :  true,
         }));
const uri = process.env.MONGO_URL

function getUserDataFromCookies (req){
    return new Promise(function(resolve, rejects) {
        jwt.verify(req.cookies.token,process.env.JWTSECRET,{},async(err,decoded)=>{
            if (err) throw err;
            resolve(decoded)
        })
    });
    
}




async function uploadToS3(path, originalFilename,mimetype){
    const s3Client = new S3Client({
        endpoint: "https://s3.tebi.io",
        region:'global',
        credentials:{
            accessKeyId:process.env.S3_ACCESS_KEY,
            secretAccessKey:process.env.S3_SECRET_ACCESS_KEY
        }
    })
    
    
    const parts = originalFilename.split('.');
    const ext = parts[parts.length-1]
    var newFileName= Date.now()+'.'+ext
    
    const data = await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Body: fs.readFileSync(path),
        Key:newFileName,
        ContentType:mimetype,
        ACL:'public-read'
    }))
    return `https://s3.tebi.io/${bucket}/${newFileName}`
    
}

app.get('/api/test',(req,res)=>{
    res.json({message:"hello world"})
})


app.post('/api/register',async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {name,email,password}=req.body

    try {
        const userDoc = await User.create({
            name,
            email,
            password:bcrypt.hashSync(password, bcryptSalt)
        });
        
        res.json(userDoc)


    } catch (error) {
        
        res.status(422).json(error)
    }
    
})

app.post('/api/login',async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {email,password}=req.body
    const userDoc =await User.findOne({email:email})
    
    if(!userDoc){
        
        res.status(422).json({message:"email is incorrect"})
    }
    if(userDoc){
        
        if(bcrypt.compareSync(password,userDoc.password)){
            jwt.sign({
                name:userDoc.name,
                email:userDoc.email,
                id:userDoc._id
            }, 
                process.env.JWTSECRET, 
                {}, (err,token)=>{
                if (err) throw err
                res.cookie('token',token).json(userDoc)
            })
            
        }else{
            
            res.status(422).json({message:"password is incorrect"})
        }
    }
})


app.get('/api/profile', async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const token = req.cookies.token
    if (token){
        const userData =await getUserDataFromCookies(req)
        
        res.json(userData)
        
    }else{
        
        res.status(401).json({message:"unauthorized"})
    }  
})


app.post('/api/logout', (req,res)=>{
    

    res.clearCookie('token').json(true)
})


app.post('/api/upload-with-link',async (req,res)=>{
    
    const {link} = req.body
    const name = Date.now() + ".jpeg"
    await imageDownloader.image({
        url:link,
        dest:'/tmp/'+ name
    });
    const url = await uploadToS3('/tmp/'+ name, name, mime.lookup('/tmp/'+ name))
    
    res.json(url)
})

const pictureMiddleware= multer({dest:'tmp'})

app.post('/api/upload',pictureMiddleware.array('pictures',100) ,async(req,res)=>{
    const uploads =[]
    for (let i=0 ; i<req.files.length; i++){
        const {path,originalname,mimetype}= req.files[i]
        
        uploads.push(await uploadToS3(path,originalname,mimetype));
        
        

    }
    
    res.json(uploads)
})

app.post("/api/place", (req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const token = req.cookies.token
    const {
        title,address,addedPhotos,
        description,perks,extraInfo,price,
        checkIn,checkOut,maxGuests
    } = req.body


    
    jwt.verify(token,process.env.JWTSECRET,{},async(err,decoded)=>{
        if (err) throw err
        const placeDocs= await Place.create({
            owner:decoded.id,
            title,address,photos:addedPhotos,
            description,perks,extraInfo,price,
            checkIn,checkOut,maxGuests
        })
        
        res.json(placeDocs)
    })
    
})


app.get('/api/user-places', (req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const token = req.cookies.token
    jwt.verify(token,process.env.JWTSECRET,{},async(err,decoded)=>{
        const {id}= decoded;
        const places = await Place.find({owner:id})
        
        res.json(places)
    })
})



app.get('/api/places/:id', async (req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {id}= req.params
    
    res.json(await Place.findById(id))
})


app.put('/api/place',(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const token = req.cookies.token;
    const {
        id,
        title,address,addedPhotos,
        description,perks,extraInfo,price,
        checkIn,checkOut,maxGuests
    } = req.body;


    jwt.verify(token,process.env.JWTSECRET,{},async(err,decoded)=>{
        let placeDoc = await Place.findOneAndUpdate({owner:decoded.id,_id:id},{
            title,address,photos:addedPhotos,
            description,perks,extraInfo,price,
            checkIn,checkOut,maxGuests
        })
        
        res.json(placeDoc)
        
    })

})

app.delete('/api/place/:id',async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {id}= req.params
    console.log(id)
    const userData=await getUserDataFromCookies(req)
    
    res.json(await Place.deleteOne({_id:id, owner:userData.id}))
})


app.get('/api/places',async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    
    res.json(await Place.find())
})



app.get('/api/room/:id', async (req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {id}= req.params
    const response= await Booking.find({place:id})
    const dates =[]
    for (let i=0 ; i<response.length; i++){
        dates.push({checkIn:response[i].checkIn,checkOut:response[i].checkOut})
    }

    const place= await Place.findById(id)
    
    res.json([place,dates])
});


app.post('/api/booking',  async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const userData=await getUserDataFromCookies(req)
    const {place,checkIn,checkOut,numberOfGuests,name,phone,price}
    =  req.body

    Booking.create({place,checkIn,checkOut,numberOfGuests,name,phone,price,user:userData.id
    }).then((doc)=>{
        
        res.json(doc)
    }).catch((err=>{
        console.error(err)
    }))
})


app.get('/api/bookings',  async (req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const userData=await getUserDataFromCookies(req)
    
    const response= await Booking.find({user:userData.id}).populate('place')
    
    
    res.json(response)

})


app.delete('/api/booking/:id',async(req,res)=>{
    mongoose.connect(uri, {useNewUrlParser: true, useUnifiedTopology: true} );
    const {id}= req.params
    console.log(id)
    const userData=await getUserDataFromCookies(req)
    
    res.json(await Booking.deleteOne({_id:id, user:userData.id}))
})



app.listen(3000);