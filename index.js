const express = require('express');
const cors = require('cors');
const app = express()
const port = 9000


require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)




app.use(cors())

let database;
let productsCollection;
let ordersCollection;
let wishlistCollection;
let usersCollection;
let paymentsCollection;
let paymentsCollect;



app.post('/api/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {

    // console.log("🔥 WEBHOOK  HIT");

    const sig = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      // console.log("✅ EVENT =", event.type);

    } catch (err) {
      console.log("❌ WEBHOOK ERROR =", err.message);

      return res.status(400).send(
        `Webhook Error: ${err.message}`
      );
    }

    if (event.type === 'checkout.session.completed') {

      const session = event.data.object;
      const metadata = session.metadata || {};

      try {

        const paymentInfo = {
          sessionId: session.id,
          transactionId: session.payment_intent || session.id,
          amount: session.amount_total / 100,
          currency: session.currency,

          buyerInfo: {
            userId: metadata.buyerId || '',
            name: metadata.buyerName || '',
            email:
              metadata.buyerMail ||
              metadata.buyerEmail ||
              session.customer_details?.email ||
              '',
            phone: metadata.buyerPhone || 'Not Provided',
            address: metadata.buyerAddress || 'Not Provided'
          },

          sellerInfo: {
            userId: metadata.sellerId || '',
            name: metadata.sellerName || 'Unknown Seller',
            email: metadata.sellerEmail || '',
            phone: metadata.sellerPhone || 'Not Provided'
          },

          productId: metadata.productId || '',

          productDetails: {
            title: metadata.productTitle || '',
            image: metadata.productImage || '',
            price: session.amount_total / 100
          },

          paymentStatus:
            session.payment_status === 'paid'
              ? 'paid'
              : session.payment_status,

          orderStatus: 'processing',

          createdAt: new Date()
        };

        // PAYMENT SAVE
        await paymentsCollection.insertOne(paymentInfo);

        // ORDER SAVE
        await ordersCollection.insertOne({
          sessionId: paymentInfo.sessionId,

          buyerInfo: paymentInfo.buyerInfo,
          sellerInfo: paymentInfo.sellerInfo,

          productId: paymentInfo.productId,

          productTitle: paymentInfo.productDetails.title,
          productImage: paymentInfo.productDetails.image,
          productPrice: paymentInfo.productDetails.price,

          paymentStatus: paymentInfo.paymentStatus,
          orderStatus: 'processing',

          createdAt: new Date()
        });

        // console.log("💳 Payment saved");
        // console.log("📦 Order saved");

      } catch (dbError) {

        console.error(
          "Database save failed:",
          dbError
        );

        return res.status(500).send(
          "Database Insertion Error"
        );
      }
    }

    res.send({ received: true });
  }
);

app.use(express.json());

// verifyToken





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


client.connect(() => {
  console.log('connecting to mongo db')
}).catch(console.dir)

// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)

//     await client.connect();
database = client.db("ri-resell-hub-client");
productsCollection = database.collection("products");
ordersCollection = database.collection("orders");
wishlistCollection = database.collection("wishlist");
usersCollection = database.collection("user");
paymentsCollection = database.collection("payments");
const sessionCollection = database.collection('session');



const verifyToken = async (req, res, next) => {

  const authHeader = req.headers?.authorization;
  // console.log(authHeader);
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  const token = authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  const query = { token: token }
  const session = await sessionCollection.findOne(query);

  if (!session) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  const userId = session.userId;


  const userQuery = {
    _id: userId
  }

  const user = await usersCollection.findOne(userQuery);
  if (!user) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  // set data in the req object
  req.user = user;
  next();
}

const verifyBuyer = async (req, res, next) => {
  if (req.user?.userRole !== 'buyer') {
    return res.status(403).send({ message: 'forbidden access' })
  }
  next();
}

// must be used after verifyToken middleware
const verifySeller = async (req, res, next) => {
  if (req.user?.userRole !== 'seller') {
    return res.status(403).send({ message: 'forbidden access' })
  }
  next();
}

// must be used after verifyToken middleware
const verifyAdmin = async (req, res, next) => {
  if (req.user.userRole !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' })
  }
  next();
}



app.get("/api/all/products", async (req, res) => {
  try {
    const {
      status,
      search = "",
      category,
      condition,
      page = 1,
      limit = 12,
    } = req.query;

    const query = {};

    if (status) {
      query.status = {
        $in: status.split(","),
      };
    }

    if (search) {
      query.$or = [
        {
          title: {
            $regex: search,
            $options: "i",
          },
        },
        {
          description: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (category && category !== "all") {
      query.category = category;
    }

    if (condition && condition !== "all") {
      query.condition = condition;
    }

    const total = await productsCollection.countDocuments(query);

    const products = await productsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .toArray();

    res.send({
      products,
      total,
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
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

// home page

app.get("/api/featured-products", async (req, res) => {
  try {
    const products = await productsCollection
      .find({
        status: "available",
      })
      .sort({ createdAt: -1 }) 
      .limit(6)                
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/categories/popular", async (req, res) => {
  try {
    const categories = await productsCollection
      .aggregate([
        {
          $match: {
            status: "available",
          },
        },
        {
          $group: {
            _id: "$category",
            totalProducts: { $sum: 1 },
          },
        },
        {
          $sort: {
            totalProducts: -1,
          },
        },
        {
          $limit: 6,
        },
        {
          $project: {
            _id: 0,
            category: "$_id",
            totalProducts: 1,
          },
        },
      ])
      .toArray();

    res.send(categories);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// seller get all products manage products

app.get('/api/products', verifyToken, verifySeller, async (req, res) => {
  const query = {};

  if (req.query.sellerId) {
    query["sellerInfo.userId"] = req.query.sellerId;
  }

  if (req.query.status) {
    query.status = req.query.status;
  }

  const result = await productsCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  res.send(result);
});
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await productsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// For Edit Find That 

app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const product = await productsCollection.findOne({
      _id: new ObjectId(id),
    });

    res.send(product);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});


// update

app.patch('/api/products/:id', async (req, res) => {

  try {
    const { id } = req.params;
    //  console.log("Request Body:", req.body);

    const {
      title,
      description,
      category,
      condition,
      price,
      stock,
      address,
      phone,
    } = req.body;

    const stockAmount = Number(stock);
    const productStatus = stockAmount > 0 ? "available" : "sold";
    const finalStock = stockAmount > 0 ? stockAmount : 0;

    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          title,
          description,
          category,
          condition,
          price,
          stock: finalStock,
          status: productStatus,
          address,
          phone,
          updatedAt: new Date(),
        },
      }
    );

    //  console.log("Updated Product:", result);

    res.send({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});


app.get('/api/my-products/search/:userId', verifyToken, verifySeller, async (req, res) => {
  try {
    const { userId } = req.params;
    const { search = '' } = req.query;

    const result = await productsCollection
      .find({
        'sellerInfo.userId': userId,
        title: {
          $regex: search,
          $options: 'i',
        },
      })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});


app.get('/api/my-products/filter/:userId', verifyToken, verifySeller, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    const query = {
      'sellerInfo.userId': userId,
    };

    if (status) {
      query.status = status;
    }

    const result = await productsCollection
      .find(query)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
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

app.get('/api/seller/stats', verifyToken, verifySeller, async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send({
        success: false,
        message: "Seller User ID is required!"
      });
    }

    const [
      totalProducts,
      totalSales,
      pendingProducts,
      processingOrders,
      salesOrders
    ] = await Promise.all([
      productsCollection.countDocuments({
        "sellerInfo.userId": userId
      }),

      ordersCollection.countDocuments({
        "sellerInfo.userId": userId,
        paymentStatus: "paid"
      }),

      productsCollection.countDocuments({
        "sellerInfo.userId": userId,
        status: "pending"
      }),

      ordersCollection.countDocuments({
        "sellerInfo.userId": userId,
        orderStatus: "processing"
      }),

      ordersCollection.find({
        "sellerInfo.userId": userId,
        paymentStatus: "paid"
      }).toArray()
    ]);

    const totalRevenue = salesOrders.reduce((sum, order) => {
      const price =
        order.productPrice ||
        order.amount ||
        order.productDetails?.price ||
        0;

      return sum + Number(price);
    }, 0);

    res.send({
      success: true,
      totalProducts,
      totalSales,
      pendingOrders: pendingProducts + processingOrders,
      totalRevenue
    });

  } catch (error) {
    console.error("Failed to fetch seller stats:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch seller stats",
      error: error.message
    });
  }
});

// manage orders

app.get('/api/seller/orders/:sellerId', verifyToken, verifySeller, async (req, res) => {
  try {
    const sellerId = req.params.sellerId;

    if (!sellerId) {
      return res.status(400).send({ success: false, message: "Seller ID is required!" });
    }

    const rawOrders = await ordersCollection
      .find({
        'sellerInfo.userId': sellerId,
      })
      .sort({ createdAt: -1 })
      .toArray();

    const orders = rawOrders.map(order => {
      return {
        ...order,
        price: order.productPrice || order.amount || order.productDetails?.price || 0,
        productTitle: order.productTitle || order.productDetails?.title || order.productName || "Premium Product"
      };
    });

    res.send(orders);

  } catch (error) {
    console.error("Error fetching seller orders:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});

app.patch('/api/orders/:id/status', verifyToken, verifySeller, async (req, res) => {
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
// analytics 
app.get('/api/seller/analytics/:sellerId', async (req, res) => {
  try {
    const sellerId = req.params.sellerId;

    const monthlySales = await paymentsCollection.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { "sellerInfo.userId": sellerId },
                { "product.seller.id": sellerId },
                { "sellerId": sellerId }
              ]
            },
            {
              $or: [
                { paymentStatus: "paid" },
                { paymentStatus: "Paid" }
              ]
            }
          ]
        }
      },
      {
        $group: {
          _id: {
            month: {
              $month: {
                $ifNull: ["$createdAt", new Date()]
              }
            }
          },
          totalRevenue: {
            $sum: {
              $ifNull: [
                "$amountPaid",
                {
                  $ifNull: [
                    "$amount",
                    {
                      $ifNull: [
                        "$price",
                        {
                          $ifNull: [
                            "$productPrice",
                            {
                              $ifNull: [
                                "$productDetails.price",
                                {
                                  $ifNull: [
                                    "$product.price",
                                    { $ifNull: ["$productDetails.amount", 0] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          },
          totalSales: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.month": 1 }
      }
    ]).toArray();

    res.send(monthlySales);
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});

app.get('/api/seller/top-products/:sellerId', async (req, res) => {
  try {
    const sellerId = req.params.sellerId;

    const products = await paymentsCollection.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { "sellerInfo.userId": sellerId },
                { "product.seller.id": sellerId },
                { "sellerId": sellerId }
              ]
            },
            {
              $or: [
                { paymentStatus: "paid" },
                { paymentStatus: "Paid" }
              ]
            }
          ]
        }
      },
      {
        $group: {
          _id: {
            $ifNull: ["$product.id", { $ifNull: ["$productId", "$_id"] }]
          },
          title: {
            $first: {
              $ifNull: ["$product.title", { $ifNull: ["$productTitle", { $ifNull: ["$productDetails.title", "Premium Product"] }] }]
            }
          },
          sales: { $sum: 1 },
          revenue: {
            $sum: {
              $ifNull: [
                "$amountPaid",
                {
                  $ifNull: [
                    "$amount",
                    {
                      $ifNull: [
                        "$price",
                        {
                          $ifNull: [
                            "$productPrice",
                            {
                              $ifNull: [
                                "$productDetails.price",
                                {
                                  $ifNull: [
                                    "$product.price",
                                    { $ifNull: ["$productDetails.amount", 0] }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      },
      {
        $sort: { sales: -1 }
      },
      {
        $limit: 5
      }
    ]).toArray();

    res.send(products);
  } catch (error) {
    console.error("Top Products Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});



// buyer 
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


    const newOrder = {
      sessionId,
      transactionId: session.payment_intent,
      amount: session.amount_total / 100,
      currency: session.currency,
      buyerInfo,
      sellerInfo,
      productId: meta.productId,
      productDetails: {
        title: product.title,
        image: product.image || product.images?.[0] || "",
        price: product.price
      },
      paymentStatus: session.payment_status,
      orderStatus: "processing",
      createdAt: new Date()
    };


    const orderResult = await ordersCollection.insertOne(newOrder);


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


// success page 
app.get('/api/orders', async (req, res) => {
  try {
    let { session_id } = req.query;

    if (!session_id) {
      return res.status(400).send({
        success: false,
        message: 'Session ID is required'
      });
    }

    // console.log("📥 ORIGINAL FROM FRONTEND =", session_id);


    // console.log(
    //   "TOTAL PAYMENTS =",
    //   await paymentsCollection.countDocuments()
    // );

    const latest = await paymentsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // console.log(
    //   "LATEST PAYMENTS =",
    //   latest.map(p => p.sessionId)
    // );

    const order = await paymentsCollection.findOne({
      sessionId: session_id
    });

    if (!order) {
      // console.log("❌ NO ORDER FOUND FOR ID:", session_id);

      return res.status(404).send({
        success: false,
        message: 'Order not found.'
      });
    }

    // console.log("✅ ORDER FOUND SUCCESSFULLY!");

    res.send({
      success: true,
      order
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: "Internal server error."
    });
  }
});



app.get('/api/buyer/my-orders/:email', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const email = req.params.email;

    const orders = await ordersCollection
      .find({ "buyerInfo.email": email })
      .sort({ createdAt: -1 }) // newest order first
      .toArray();

    const ordersWithProductDetails = await Promise.all(
      orders.map(async (order) => {
        let productInfo = null;

        try {
          productInfo = await productsCollection.findOne({
            _id: new ObjectId(order.productId)
          });
        } catch (err) {
          console.log("Product lookup failed:", err.message);
        }

        return {
          ...order,
          productTitle:
            order.productTitle ||
            productInfo?.title ||
            "Product Unavailable",

          productImage:
            order.productImage ||
            productInfo?.images?.[0] ||
            productInfo?.image ||
            "https://via.placeholder.com/150",

          productPrice:
            order.productPrice ||
            productInfo?.price ||
            0,

          sellerInfo:
            order.sellerInfo ||
            productInfo?.sellerInfo ||
            null
        };
      })
    );

    res.send(ordersWithProductDetails);

  } catch (error) {
    console.error("Failed to fetch orders:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch orders"
    });
  }
});


app.patch('/api/orders/:id/cancel', verifyToken, verifyBuyer, async (req, res) => {
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


app.patch('/api/wishlist/status', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const { userId, productId } = req.query;
    // console.log("Checking Wishlist Data:", { userId, productId });
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


app.get('/api/wishlist/remove', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const { userId, productId } = req.query;
    await wishlistCollection.deleteOne({ userId, productId });
    res.send({ success: true, message: "Removed from wishlist!" });
  } catch (error) {
    res.status(500).send({ message: "Failed to remove from wishlist", error });
  }
});


app.get('/api/wishlist/status', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const { userId, productId } = req.query;
    const item = await wishlistCollection.findOne({ userId, productId });
    res.send({ isWishlisted: !!item });
  } catch (error) {
    res.status(500).send({ message: "Error checking status", error });
  }
});

app.get('/api/wishlist/user/:email', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const email = req.params.email;


    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const wishlistItems = await wishlistCollection
      .find({ userId: user._id.toString() })
      .sort({ createdAt: -1 }) // newest first
      .toArray();


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


app.get('/api/buyer/dashboard-summary', verifyToken, verifyBuyer, async (req, res) => {
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
      .sort({ createdAt: -1 })
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
          date: order.createdAt || order.date || new Date(),
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



app.patch('/api/users/update-profile', verifyToken, verifyBuyer, async (req, res) => {
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

app.patch('/api/users/change-password', verifyToken, verifyBuyer, async (req, res) => {
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




app.get('/api/payments/buyer/:email', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const { email } = req.params;

    const payments = await paymentsCollection
      .find({
        "buyerInfo.email": email,
      })
      .sort({ createdAt: -1 }) 
      .toArray();

    res.send({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
});


// admin
app.patch('/api/admin/users/:id/status', verifyToken, verifyAdmin, async (req, res) => {
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

// admin manage product 

app.get('/api/all/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const query = {};

    if (req.query.status) {
      query.status = req.query.status;
    }

    const result = await productsCollection
      .find(query)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch products",
      error
    });
  }
});

app.patch('/api/admin/products/:id/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    let status;

    if (action === 'approve') {
      status = 'available';
    } else if (action === 'reject') {
      status = 'rejected';
    } else {
      return res.status(400).send({
        success: false,
        message: 'Invalid action',
      });
    }

    const result = await productsCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: 'Product not found',
      });
    }

    res.send({
      success: true,
      message:
        action === 'approve'
          ? 'Product approved successfully'
          : 'Product rejected successfully',
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.delete('/api/admin/products/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;


    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: 'Invalid product id',
      });
    }

    const product = await productsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: 'Product not found',
      });
    }

    const result = await productsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: 'Product deleted successfully',
      deletedProduct: {
        id: product._id,
        title: product.title,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// admin manage order

app.get('/api/admin/orders', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await ordersCollection
      .aggregate([
        {
          $lookup: {
            from: 'products',
            let: {
              productObjectId: {
                $toObjectId: '$productId',
              },
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$_id', '$$productObjectId'],
                  },
                },
              },
              {
                $project: {
                  title: 1,
                  price: 1,
                  images: 1,
                  category: 1,
                  status: 1,
                },
              },
            ],
            as: 'productDetails',
          },
        },
        {
          $unwind: {
            path: '$productDetails',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: {
            createdAt: -1,
          },
        },
      ])
      .toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.patch('/api/admin/orders/:id/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await ordersCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          orderStatus: status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({
        success: false,
        message: 'Order not found',
      });
    }

    res.send({
      success: true,
      message: 'Order status updated successfully',
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

//  analytics

app.get('/api/admin/analytics', async (req, res) => {
  try {

    const totalUsers = await usersCollection.countDocuments();
    const totalProducts = await productsCollection.countDocuments();
    const totalOrders = await paymentsCollection.countDocuments({
      $or: [{ paymentStatus: "paid" }, { paymentStatus: "Paid" }]
    });
    const totalWishlist = await wishlistCollection.countDocuments();


    const revenueStats = await paymentsCollection.aggregate([
      {
        $match: {
          $or: [
            { paymentStatus: "paid" },
            { paymentStatus: "Paid" }
          ]
        }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $toDouble: {
                $ifNull: [
                  "$amountPaid",
                  {
                    $ifNull: [
                      "$amount",
                      {
                        $ifNull: [
                          "$price",
                          {
                            $ifNull: [
                              "$buyerInfo.amount",
                              {
                                $ifNull: [
                                  "$product.price",
                                  { $ifNull: ["$productDetails.price", 0] }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    ]).toArray();

    const totalRevenue = revenueStats.length > 0 ? revenueStats[0].total : 0;

    const monthlyOrders = await paymentsCollection.aggregate([
      {
        $match: {
          $or: [{ paymentStatus: "paid" }, { paymentStatus: "Paid" }]
        }
      },
      {
        $group: {
          _id: { month: { $month: { $ifNull: ["$createdAt", new Date()] } } },
          totalSales: { $sum: 1 }
        }
      },
      { $sort: { "_id.month": 1 } }
    ]).toArray();


    const userGrowth = await usersCollection.aggregate([
      {
        $group: {
          _id: { month: { $month: { $ifNull: ["$createdAt", new Date()] } } },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.month": 1 } }
    ]).toArray();

    const categoryPerformance = await productsCollection.aggregate([
      {
        $group: {
          _id: "$category",
          products: { $sum: 1 }
        }
      }
    ]).toArray();


    res.send({
      overview: {
        totalUsers,
        totalProducts,
        totalOrders,
        totalRevenue,
        totalWishlist
      },
      userGrowth,
      monthlyOrders,
      categoryPerformance
    });

  } catch (error) {
    console.error("Admin Analytics Error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});

// admin stats

app.get('/api/admin/dashboard-stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const totalUsers =
      await usersCollection.countDocuments();

    const totalProducts =
      await productsCollection.countDocuments();

    const totalOrders =
      await ordersCollection.countDocuments();

    res.send({
      totalUsers,
      totalProducts,
      totalOrders,
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
// await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
//     // await client.close();
//   }
// }
// run().catch(console.dir);


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

module.exports = app;