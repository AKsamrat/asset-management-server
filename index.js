const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
// const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;
const app = express();

const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
// app.use(cookieParser());

// verify jwt middleware
const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  // console.log('inside verify token', req.headers);

  const token = req.headers.authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: 'unauthorized access' });
    }
    console.log(decoded);

    req.decoded = decoded;
    next();
  });

  // const token = req.cookies?.token;
  // if (!token) return res.status(401).send({ message: 'unauthorized access' });
  // if (token) {
  //   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
  //     if (err) {
  //       console.log(err);
  //       return res.status(401).send({ message: 'unauthorized access' });
  //     }
  //     console.log(decoded);

  //     req.user = decoded;
  //     next();
  //   });
  // }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nj7eiar.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const userCollection = client.db('assetManagement').collection('users');

    app.post('/jwt', async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      });
      res.send({ token });

      // res
      //   .cookie('token', token, {
      //     httpOnly: true,
      //     secure: process.env.NODE_ENV === 'production',
      //     sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      //   })
      //   .send({ success: true });
    });

    // Clear token on logout
    app.get('/logout', (req, res) => {
      res
        .clearCookie('token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          maxAge: 0,
        })
        .send({ success: true });
    });

    //admin verify middleware======================
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    };

    //================================================

    //user related

    //load all user
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      // console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //for admin check
    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      console.log(email);
      console.log(req.decoded.email);
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      console.log(admin);
      res.send({ admin });
    });

    //save user data in db

    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      //check if user already have

      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return;
      }
      const option = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await userCollection.updateOne(query, updateDoc, option);

      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exist' });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.delete('/user/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    //make admin

    app.patch(
      '/users/admin/:id',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        updateDoc = {
          $set: {
            role: 'admin',
          },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    //payment system implementation

    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });
    // app.post('/payments', async (req, res) => {
    //   const payment = req.body;
    //   payment.menuItemId = payment.menuItemId.map(id => new ObjectId(id));
    //   payment.cartId = payment.cartId.map(id => new ObjectId(id));
    //   const result = await paymentCollection.insertOne(payment);

    //   //delete each item from cart
    //   const query = {
    //     _id: {
    //       $in: payment.cartId.map(id => new ObjectId(id)),
    //     },
    //   };
    //   const deleteResult = await cartCollection.deleteMany(query);
    //   res.send({ result, deleteResult });
    // });

    // app.get('/payments/:email', verifyToken, async (req, res) => {
    //   const query = { email: req.params.email };
    //   if (req.params.email !== req.decoded.email) {
    //     return res.status(403).send({ message: 'forbidden access' });
    //   }
    //   const result = await paymentCollection.find(query).toArray();
    //   res.send(result);
    // });

    //statistics ans analytics

    // app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
    //   const user = await userCollection.estimatedDocumentCount();
    //   const menuItems = await menuCollection.estimatedDocumentCount();
    //   const orders = await paymentCollection.estimatedDocumentCount();
    //   // const payment = await paymentCollection.find().toArray();
    //   // const revenue = await payment.reduce(
    //   //   (total, payment) => total + payment.price,
    //   //   0
    //   // );
    //   const result = await paymentCollection
    //     .aggregate([
    //       {
    //         $group: {
    //           _id: null,
    //           totalRevenue: {
    //             $sum: '$price',
    //           },
    //         },
    //       },
    //     ])
    //     .toArray();
    //   const revenue = result.length > 0 ? result[0].totalRevenue : 0;
    //   res.send({ user, menuItems, orders, revenue });
    // });

    //order status=============
    // app.get('/order-stats', async (req, res) => {
    //   const result = await paymentCollection
    //     .aggregate([
    //       {
    //         $unwind: '$menuItemId',
    //       },
    //       {
    //         $lookup: {
    //           from: 'menu',
    //           localField: 'menuItemId',
    //           foreignField: '_id',
    //           as: 'menuItems',
    //         },
    //       },
    //       {
    //         $unwind: '$menuItems',
    //       },
    //       {
    //         $group: {
    //           _id: '$menuItems.category',
    //           quantity: { $sum: 1 },
    //           revenue: { $sum: '$menuItems.price' },
    //         },
    //       },
    //       {
    //         $project: {
    //           _id: 0,
    //           category: '$_id',
    //           quantity: '$quantity',
    //           revenue: '$revenue',
    //         },
    //       },
    //     ])
    //     .toArray();
    //   res.send(result);
    // });

    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get('/', (req, res) => {
  res.send('Hello from bistro boss Server....');
});

app.listen(port, () => console.log(`Server running on port ${port}`));
