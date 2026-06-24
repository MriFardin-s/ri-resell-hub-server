const express = require('express');
const cors = require('cors');
const app = express()
const port = 9000


require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)




app.use(cors())

let productsCollection;
let ordersCollection;
let wishlistCollection;
let usersCollection;
let paymentsCollection;
let paymentsCollect
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    try {
      const paymentInfo = {
        stripeSessionId: session.id,
        amountPaid: session.amount_total / 100,
        currency: session.currency,
        paymentStatus: session.payment_status,
        createdAt: new Date(),

        buyer: {
          id: metadata.buyerId,
          name: metadata.buyerName,
          email: metadata.buyerMail,
          phone: metadata.buyerPhone,
          address: metadata.buyerAddress
        },
        product: {
          id: metadata.productId,
          title: metadata.productTitle,
          image: metadata.productImage,
          seller: {
            id: metadata.sellerId,
            name: metadata.sellerName,
            email: metadata.sellerEmail,
            phone: metadata.sellerPhone
          }
        }
      };


      const result = await paymentsCollection.insertOne(paymentInfo);
      console.log("💳 Payment successfully saved to database!", result.insertedId);

    } catch (dbError) {
      console.error("Failed to save payment to database:", dbError);
      return res.status(500).send("Database Insertion Error");
    }
  }

  res.send({ received: true });
});

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
    database = client.db("ri-resell-hub-client");
    productsCollection = database.collection("products");
    ordersCollection = database.collection("orders");
    wishlistCollection = database.collection("wishlist");
    usersCollection = database.collection("user");
    paymentsCollection = database.collection("payments");

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

    //homepage

    app.get('/api/seller/stats/:sellerId', async (req, res) => {
      try {
        const sellerId = req.params.sellerId;

        const totalProducts = await productsCollection.countDocuments({
          "sellerInfo.userId": sellerId
        });

        const totalSales = await ordersCollection.countDocuments({
          "sellerInfo.userId": sellerId,
          paymentStatus: "paid"
        });

        const pendingOrders = await ordersCollection.countDocuments({
          "sellerInfo.userId": sellerId,
          orderStatus: {
            $in: ["pending", "processing"]
          }
        });

        const revenueResult = await paymentsCollection.aggregate([
          {
            $match: {
              "product.seller.id": sellerId,
              paymentStatus: "paid"
            }
          },
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$amountPaid"
              }
            }
          }
        ]).toArray();

        res.send({
          totalProducts,
          totalSales,
          pendingOrders,
          totalRevenue: revenueResult[0]?.totalRevenue || 0
        });

      } catch (error) {
        res.status(500).send({
          message: "Failed to fetch seller stats",
          error: error.message
        });
      }
    });

    // manage orders

    app.get('/api/seller/orders/:sellerId', async (req, res) => {
      const sellerId = req.params.sellerId;

      const orders = await ordersCollection
        .find({
          'sellerInfo.userId': sellerId,
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(orders);
    });

    app.patch('/api/orders/:id/status', async (req, res) => {
      const { status } = req.body;

      const result = await ordersCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
        },
        {
          $set: {
            orderStatus: status,
          },
        }
      );

      res.send({
        success: result.modifiedCount > 0,
      });
    });

    app.get('/api/seller/analytics/:sellerId', async (req, res) => {
      try {
        const sellerId = req.params.sellerId;

        const monthlySales = await paymentsCollection.aggregate([
          {
            $match: {
              "product.seller.id": sellerId,
              paymentStatus: "paid"
            }
          },
          {
            $group: {
              _id: {
                month: {
                  $month: "$createdAt"
                }
              },
              totalRevenue: {
                $sum: "$amountPaid"
              },
              totalSales: {
                $sum: 1
              }
            }
          },
          {
            $sort: {
              "_id.month": 1
            }
          }
        ]).toArray();

        res.send(monthlySales);
      } catch (error) {
        res.status(500).send(error);
      }
    });

    app.get('/api/seller/top-products/:sellerId', async (req, res) => {
      try {
        const sellerId = req.params.sellerId;

        const products = await paymentsCollection.aggregate([
          {
            $match: {
              "product.seller.id": sellerId,
              paymentStatus: "paid"
            }
          },
          {
            $group: {
              _id: "$product.id",
              title: {
                $first: "$product.title"
              },
              sales: {
                $sum: 1
              },
              revenue: {
                $sum: "$amountPaid"
              }
            }
          },
          {
            $sort: {
              sales: -1
            }
          },
          {
            $limit: 5
          }
        ]).toArray();

        res.send(products);
      } catch (error) {
        res.status(500).send(error);
      }
    });



    // buyer 
    app.post('/api/orders', async (req, res) => {
      const { sessionId } = req.body;

      try {
        // ১. চেক করুন অর্ডারটি আগেই প্রসেস করা হয়েছে কি না
        const existingOrder = await ordersCollection.findOne({ sessionId });
        if (existingOrder) {
          return res.status(200).json({
            success: true,
            message: "Order already processed",
            order: existingOrder
          });
        }

        // ২. স্ট্রাইপ সেশন থেকে ডাটা রিট্রিভ করুন
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const meta = session.metadata;

        if (!session || session.payment_status !== 'paid') {
          return res.status(400).json({ message: "Payment not verified or completed" });
        }

        // ৩. ডাটাবেজ থেকে প্রোডাক্টের কারেন্ট ইনফো (দাম এবং নাম) নিয়ে আসুন
        const product = await productsCollection.findOne({ _id: new ObjectId(meta.productId) });
        if (!product) {
          return res.status(404).json({ message: "Product not found in database" });
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

        // ৪. নতুন অর্ডার অবজেক্টে ফ্রন্টএন্ডের প্রয়োজনীয় সব ফিল্ড যোগ করুন
        const newOrder = {
          sessionId,
          transactionId: session.payment_intent, // 🎯 স্ট্রাইপের ট্রানজেকশন আইডি (Payment Intent ID)
          amount: session.amount_total / 100,     // 🎯 ফ্রন্টএন্ডের orderData?.amount এর জন্য সঠিক ফরম্যাট
          currency: session.currency,
          buyerInfo,
          sellerInfo,
          productId: meta.productId,
          productDetails: {                       // 🎯 Order Summary দেখানোর জন্য প্রোডাক্ট ডিটেইলস
            title: product.title,
            image: product.image || product.images?.[0] || "",
            price: product.price
          },
          paymentStatus: session.payment_status,
          orderStatus: "processing",
          createdAt: new Date()
        };

        // ৫. অর্ডার ডাটাবেজে ইনসার্ট করুন
        const orderResult = await ordersCollection.insertOne(newOrder);

        // ৬. প্রোডাক্টের স্টক আপডেট লজিক
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

        // ৭. ফ্রন্টএন্ডে সম্পূর্ণ অবজেক্টটি রেসপন্স হিসেবে পাঠান
        return res.status(201).json({
          success: true,
          message: "Order placed and stock updated successfully",
          order: {
            _id: orderResult.insertedId,
            ...newOrder
          }
        });

      } catch (error) {
        console.error("Order completion error:", error);
        return res.status(500).json({ message: "Failed to process order", error: error.message });
      }
    });



    app.get('/api/buyer/my-orders/:email', async (req, res) => {
      try {
        const email = req.params.email;


        const orders = await ordersCollection.find({ "buyerInfo.email": email }).sort({ createdAt: -1 }).toArray();


        const ordersWithProductDetails = await Promise.all(orders.map(async (order) => {
          let productInfo = null;
          try {
            productInfo = await productsCollection.findOne({ _id: new ObjectId(order.productId) });
          } catch (err) {

          }

          return {
            ...order,
            productTitle: productInfo?.title || "Product Unavailable",
            productImage: productInfo?.images?.[0] || productInfo?.image || "https://via.placeholder.com/150",
            productPrice: productInfo?.price || 0,
            sellerInfo: productInfo?.sellerInfo || null
          };
        }));

        res.send(ordersWithProductDetails);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch orders", error });
      }
    });


    app.patch('/api/orders/:id/cancel', async (req, res) => {
      try {
        const orderId = req.params.id;
        const query = { _id: new ObjectId(orderId) };


        const order = await ordersCollection.findOne(query);
        if (!order) {
          return res.status(404).send({ message: "Order not found" });
        }


        if (order.orderStatus !== 'pending' && order.orderStatus !== 'processing') {
          return res.status(400).send({ message: "Order cannot be cancelled at this stage." });
        }


        const updateResult = await ordersCollection.updateOne(query, {
          $set: { orderStatus: "cancelled" }
        });


        await productsCollection.updateOne(
          { _id: new ObjectId(order.productId) },
          {
            $inc: { stock: 1 },
            $set: { status: "available" }
          }
        );

        res.send({ success: true, message: "Order cancelled successfully and product restocked." });
      } catch (error) {
        res.status(500).send({ message: "Failed to cancel order", error });
      }
    });


    // Wishlist


    app.patch('/api/wishlist/status', async (req, res) => {
      try {
        const { userId, productId } = req.query;
        console.log("Checking Wishlist Data:", { userId, productId });
        const query = { userId, productId };

        const existing = await wishlistCollection.findOne(query);

        if (existing) {
          await wishlistCollection.deleteOne(query);
          return res.send({ success: true, isWishlisted: false, message: "Removed from wishlist" });
        } else {
          await wishlistCollection.insertOne({
            userId,
            productId,
            createdAt: new Date()
          });
          const totalDocs = await wishlistCollection.countDocuments();

          return res.send({ success: true, isWishlisted: true, message: "Added to wishlist!" });
        }
      } catch (error) {
        res.status(500).send({ message: "Failed to update wishlist", error });
      }
    });


    app.get('/api/wishlist/remove', async (req, res) => {
      try {
        const { userId, productId } = req.query;
        await wishlistCollection.deleteOne({ userId, productId });
        res.send({ success: true, message: "Removed from wishlist!" });
      } catch (error) {
        res.status(500).send({ message: "Failed to remove from wishlist", error });
      }
    });


    app.get('/api/wishlist/status', async (req, res) => {
      try {
        const { userId, productId } = req.query;
        const item = await wishlistCollection.findOne({ userId, productId });
        res.send({ isWishlisted: !!item });
      } catch (error) {
        res.status(500).send({ message: "Error checking status", error });
      }
    });

    app.get('/api/wishlist/user/:email', async (req, res) => {
      try {
        const email = req.params.email;


        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        const wishlistItems = await wishlistCollection.find({ userId: user._id.toString() }).toArray();


        const itemsWithProductDetails = await Promise.all(wishlistItems.map(async (item) => {
          let productInfo = null;
          try {
            productInfo = await productsCollection.findOne({ _id: new ObjectId(item.productId) });
          } catch (err) { }

          return {
            _id: item._id,
            productId: item.productId,
            productTitle: productInfo?.title || "Product Unavailable",
            productImage: productInfo?.images?.[0] || productInfo?.image || "https://via.placeholder.com/150",
            productPrice: productInfo?.price || 0,
            stock: productInfo?.stock || 0
          };
        }));

        res.send(itemsWithProductDetails);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch wishlist", error });
      }
    });


    app.get('/api/buyer/dashboard-summary', async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).send({ success: false, message: "Email parameter is required!" });
        }


        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ success: false, message: "User not found!" });
        }


        const totalOrders = await ordersCollection.countDocuments({
          "buyerInfo.email": email
        });


        const wishlistCount = await wishlistCollection.countDocuments({
          userId: user._id.toString()
        });


        const recentOrdersRaw = await ordersCollection.find({ "buyerInfo.email": email })
          .sort({ date: -1 })
          .limit(5)
          .toArray();


        const recentPurchases = await Promise.all(
          recentOrdersRaw.map(async (order) => {
            let productInfo = null;

            try {
              if (order.productId && ObjectId.isValid(order.productId)) {
                productInfo = await productsCollection.findOne({ _id: new ObjectId(order.productId) });
              }
            } catch (err) {
              console.error("Error fetching product for order:", err.message);
            }

            return {
              _id: order._id,
              productName: order.productTitle || order.productName || order.title || productInfo?.title || "Product Unavailable",
              price: order.productPrice || order.price || order.totalPrice || productInfo?.price || 0,
              date: order.date || order.createdAt || new Date(),
              orderStatus: order.orderStatus || 'pending'
            };
          })
        );


        res.send({
          success: true,
          totalOrders,
          wishlistCount,
          recentPurchases
        });

      } catch (error) {
        console.error("Error fetching buyer dashboard summary:", error);
        res.status(500).send({ success: false, message: "Internal server error", error: error.message });
      }
    });



    app.patch('/api/users/update-profile', async (req, res) => {
      try {
        const { email, name, phone, address, image } = req.body;

        if (!email) {
          return res.status(400).send({ success: false, message: "Email is required!" });
        }

        const result = await usersCollection.updateOne(
          { email: email },
          {
            $set: {
              name,
              phone,
              address,
              image,
              updatedAt: new Date()
            }
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(400).send({ success: false, message: "No changes were made or user not found." });
        }

        res.send({ success: true, message: "Public profile updated successfully!" });

      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).send({ success: false, message: "Internal server error." });
      }
    });

    app.patch('/api/users/change-password', async (req, res) => {
      try {
        const { email, currentPassword, newPassword } = req.body;

        if (!email || !currentPassword || !newPassword) {
          return res.status(400).send({ success: false, message: "All fields are required!" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ success: false, message: "User not found!" });
        }

        if (user.password !== currentPassword) {
          return res.status(400).send({ success: false, message: "Current password is incorrect!" });
        }

        await usersCollection.updateOne(
          { email },
          { $set: { password: newPassword, passwordUpdatedAt: new Date() } }
        );

        res.send({ success: true, message: "Password changed successfully!" });

      } catch (error) {
        console.error("Password change error:", error);
        res.status(500).send({ success: false, message: "Internal server error." });
      }
    });




    app.get('/api/payments/buyer/:email', async (req, res) => {
      try {
        const { email } = req.params;

        const payments = await paymentsCollection
          .find({ "buyer.email": email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ success: true, data: payments });
      } catch (error) {
        console.error("Fetch payment history error:", error);
        res.status(500).send({ success: false, message: "Internal server error." });
      }
    });



    // admin
    app.patch('/api/admin/users/:id/status', async (req, res) => {
      try {
        const { id } = req.params;
        const { banned, action } = req.body;
        
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!user) {
          return res.status(404).send({ success: false, message: 'User not found' });
        }

        
        let updateFields = { updatedAt: new Date() };

       
        if (banned !== undefined) {
          updateFields.banned = banned;
        }

        
        let messageDetail = banned ? 'User blocked' : 'User unblocked';

        if (action === 'make_admin') {
          if (user.role === 'admin') {
            return res.status(400).send({ success: false, message: 'User is already an admin' });
          }
          
          updateFields.previousRole = user.role;
          updateFields.role = 'admin';
          messageDetail = 'User promoted to Admin successfully';
        }

        else if (action === 'remove_admin') {
          if (user.role !== 'admin') {
            return res.status(400).send({ success: false, message: 'User is not an admin' });
          }
   
          updateFields.role = user.previousRole || 'buyer';
          updateFields.$unset = { previousRole: "" }; 
          messageDetail = `Admin reverted back to ${updateFields.role} successfully`;
        }

    
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          updateFields.$unset
            ? { $set: { banned: updateFields.banned, role: updateFields.role, updatedAt: updateFields.updatedAt }, $unset: updateFields.$unset }
            : { $set: updateFields }
        );

        res.send({
          success: true,
          message: messageDetail,
        });

      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: error.message });
      }
    });


    app.delete('/api/admin/users/:id', async (req, res) => {
      try {
        const { id } = req.params;

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: 'User not found',
          });
        }

        res.send({
          success: true,
          message: 'User account deleted successfully',
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: error.message,
        });
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