const express = require('express');
const cors = require('cors');
const app = express()
const port = 9000


require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


app.use(cors())
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!')
})




const uri = process.env.MONGO_DB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)

    await client.connect();
    const database = client.db("ri-resell-hub-client");
    const productsCollection = database.collection("products");
    const ordersCollection = database.collection("orders");

    app.get('/api/all/products', async (req, res) => {
      try {
        const query = {};
        if (req.query.status) {
          query.status = req.query.status;
        }
        const result = await productsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products", error });
      }
    });

    app.get('/api/all/products/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Product not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch product", error });
      }
    });
    // seller get all products
    app.get('/api/products', async (req, res) => {
      const query = {};
      if (req.query.sellerId) {
        query["sellerInfo.userId"] = req.query.sellerId;
      }

      if (req.query.status) {
        query.status = req.query.status;
      }


      const cursor = productsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post('/api/products', async (req, res) => {
      const product = req.body;
      const newProduct = {
        ...product,
        createdAt: new Date()
      }
      const result = await productsCollection.insertOne(newProduct);
      res.send(result);
    });




    app.post('/api/orders', async (req, res) => {
      const { sessionId } = req.body; 

      try {
        
        const existingOrder = await ordersCollection.findOne({ sessionId });
        if (existingOrder) {
          return res.status(200).json({
            success: true,
            message: "Order already processed",
            order: existingOrder
          });
        }

       
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const meta = session.metadata;

        if (!session || session.payment_status !== 'paid') {
          return res.status(400).json({ message: "Payment not verified or completed" });
        }

       
        const buyerInfo = {
          userId: meta.buyerId,
          name: meta.buyerName,
          email: meta.buyerMail,
          phone: meta.buyerPhone,
          address: meta.buyerAddress
        };

        const sellerInfo = {
          userId: meta.sellerId,
          name: meta.sellerName,
          email: meta.sellerEmail,
          phone: meta.sellerPhone
        };

        const newOrder = {
          sessionId,
          buyerInfo,
          sellerInfo,
          productId: meta.productId,
          paymentStatus: session.payment_status, 
          orderStatus: "processing",
          createdAt: new Date()
        };

        const orderResult = await ordersCollection.insertOne(newOrder);

        
        const product = await productsCollection.findOne({ _id: new ObjectId(meta.productId) });
        if (product) {
          if (product.stock <= 1) {
            await productsCollection.updateOne(
              { _id: new ObjectId(meta.productId) },
              { $set: { stock: 0, status: "sold" } }
            );
          } else {
            await productsCollection.updateOne(
              { _id: new ObjectId(meta.productId) },
              { $set: { stock: product.stock - 1 } } 
            );
          }
        }

        
        return res.status(201).json({
          success: true,
          message: "Order placed and stock updated successfully",
          order: {
            _id: orderResult.insertedId,
            ...newOrder
          }
        });

      } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to process order", error: error.message });
      }
    });






    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})