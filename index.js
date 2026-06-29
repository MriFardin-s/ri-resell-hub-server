const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 9000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {

  res.send('Hello World!')

})

const uri = process.env.MONGO_DB_URI;

// let client;
// let database;
// let productsCollection;
// let ordersCollection;
// let wishlistCollection;
// let usersCollection;
// let paymentsCollection;
// let sessionCollection;



client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // maxPoolSize: 10,
  // serverSelectionTimeoutMS: 5000,
});

client.connect(() => {

  console.log('connecting to mongo db')

}).catch(console.dir)
const database = client.db("ri-resell-hub-client");

const productsCollection = database.collection("products");
const ordersCollection = database.collection("orders");
const wishlistCollection = database.collection("wishlist");
const usersCollection = database.collection("user");
const paymentsCollection = database.collection("payments");
const sessionCollection = database.collection('session');





const verifyToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const query = { token: token };
  const session = await sessionCollection.findOne(query);

  if (!session) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const userId = session.userId;
  const userQuery = { _id: typeof userId === 'string' ? new ObjectId(userId) : userId };

  const user = await usersCollection.findOne(userQuery);
  if (!user) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  req.user = user;
  next();
};



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
      sort,
      page = 1,
      limit = 12,
    } = req.query;

    const query = {
      status: {
        $in: ["available", "sold"],
      },
    };

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

    let sortOption = { createdAt: -1 };
    if (sort === "price_asc") {
      sortOption = { price: 1 };
    } else if (sort === "price_desc") {
      sortOption = { price: -1 };
    }

    const total = await productsCollection.countDocuments(query);

    const products = await productsCollection
      .find(query)
      .sort(sortOption)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .toArray();

    res.send({
      products,
      total,
    });

  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.get('/api/all/products/:id', async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid product ID format" , ok:false });
    }

    const query = { _id: new ObjectId(id) };
    const result = await productsCollection.findOne(query);

    if (!result) {
      return res.status(404).send({ message: "Product not found" });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch product", error: error.message });
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
app.delete('/api/products/:id', verifyToken, verifySeller, async (req, res) => {
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

app.get('/api/products/:id', verifyToken, verifySeller, async (req, res) => {
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

app.patch("/api/products/:id", verifyToken, verifySeller, async (req, res) => {
  try {
    const { id } = req.params;

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
    const finalStock = Math.max(stockAmount, 0);


    const productStatus =
      finalStock > 0 ? "pending" : "sold";

    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          title,
          description,
          category,
          condition,
          price: Number(price),
          stock: finalStock,
          status: productStatus,
          address,
          phone,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });
    }

    res.send({
      success: true,
      message: "Product updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error(error);

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


app.post("/api/products", async (req, res) => {

  try {
    const product = req.body;

    const stock = Number(product.stock);

    const newProduct = {
      ...product,
      stock: Math.max(stock, 0),


      status: stock > 0 ? "pending" : "sold",

      createdAt: new Date(),
      updatedAt: new Date(),
    };


    const result = await productsCollection.insertOne(newProduct);

    res.send({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: err.message,
    });
  }
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
          "sellerInfo.userId": sellerId,
          paymentStatus: "paid"
        }
      },
      {

        $group: {
          _id: { $month: "$createdAt" },
          totalRevenue: { $sum: { $ifNull: ["$amount", { $ifNull: ["$productDetails.price", 0] }] } },
          totalSales: { $sum: 1 }
        }
      },
      {

        $project: {
          _id: 0,
          month: "$_id",
          totalRevenue: 1,
          totalSales: 1
        }
      },
      {
        $sort: { "month": 1 }
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
          "sellerInfo.userId": sellerId,
          paymentStatus: "paid"
        }
      },
      {

        $group: {
          _id: "$productId",
          title: { $first: { $ifNull: ["$productDetails.title", "Premium Product"] } },
          sales: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$amount", { $ifNull: ["$productDetails.price", 0] }] } }
        }
      },
      {

        $project: {
          _id: 0,
          id: "$_id",
          title: 1,
          sales: 1,
          revenue: 1
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


app.post("/api/orders",  async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID is required",
      });
    }

    // Stripe Session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    if (session.payment_status !== "paid") {
      return res.status(400).send({
        success: false,
        message: "Payment not completed",
      });
    }

    // Duplicate check
    const alreadyExists = await ordersCollection.findOne({
      sessionId,
    });

    if (alreadyExists) {
      return res.send({
        success: true,
        message: "Order already exists",
      });
    }

    const metadata = session.metadata;

    // Product
    const product = await productsCollection.findOne({
      _id: new ObjectId(metadata.productId),
    });

    if (!product) {
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });
    }

    //-----------------------------------
    // Order document
    //-----------------------------------

    const order = {
      sessionId,

      transactionId: session.payment_intent.id,

      amount: session.amount_total / 100,

      currency: session.currency,

      paymentStatus: session.payment_status,

      orderStatus: "processing",

      buyerInfo: {
        id: metadata.buyerId,
        name: metadata.buyerName,
        email: metadata.buyerEmail,
        phone: metadata.buyerPhone,
        address: metadata.buyerAddress,
      },

      sellerInfo: product.sellerInfo,

      productId: metadata.productId,

      productDetails: {
        title: product.title,
        image: product.images?.[0],
        price: product.price,
      },

      createdAt: new Date(),
    };

    //-----------------------------------
    // Save order
    //-----------------------------------

    await ordersCollection.insertOne(order);

    //-----------------------------------
    // Save payment history
    //-----------------------------------

    await paymentsCollection.insertOne({
      ...order,
    });

    //-----------------------------------
    // Update product
    //-----------------------------------

    const newStock = Math.max((product.stock || 0) - 1, 0);

    await productsCollection.updateOne(
      {
        _id: product._id,
      },
      {
        $set: {
          stock: newStock,
          status: newStock === 0 ? "sold" : "available",
          updatedAt: new Date(),
        },
      }
    );

    res.send({
      success: true,
      message: "Order created successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});


// success page 
app.get('/api/orders', verifyToken, verifyBuyer, async (req, res) => {
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

    if (email !== req.user?.email) {
      return res.status(403).send({ success: false, message: "Forbidden Access" });
    }

    const ordersWithDetails = await ordersCollection.aggregate([
      { $match: { "buyerInfo.email": email } },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          convertedProductId: {
            $cond: {
              if: { $eq: [{ $type: "$productId" }, "string"] },
              then: { $toObjectId: "$productId" },
              else: "$productId"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "convertedProductId",
          foreignField: "_id",
          as: "dbProduct"
        }
      },
      {
        $unwind: {
          path: "$dbProduct",
          preserveNullAndEmptyArrays: true
        }
      }
    ]).toArray();

    const finalOrders = ordersWithDetails.map(order => {
      const productInfo = order.dbProduct;
      const savedDetails = order.productDetails || {};

      return {
        _id: order._id,
        sessionId: order.sessionId,
        transactionId: order.transactionId,
        amount: order.amount,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        buyerInfo: order.buyerInfo,
        sellerInfo: order.sellerInfo || productInfo?.sellerInfo || null,


        productId: order.productId,

        productTitle: savedDetails.title || productInfo?.title || "Product Unavailable",
        productImage: savedDetails.image || productInfo?.image || productInfo?.images?.[0] || "https://via.placeholder.com/150",
        productPrice: savedDetails.price || productInfo?.price || order.amount || 0
      };
    });

    res.send(finalOrders);

  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Failed to fetch orders",
      error: error.message
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

    if (order.buyerInfo?.email !== req.user?.email) {
      return res.status(403).send({ message: "Forbidden! You can only cancel your own orders." });
    }

    if (order.orderStatus !== 'pending' && order.orderStatus !== 'processing') {
      return res.status(400).send({ message: "Order cannot be cancelled at this stage." });
    }

    await ordersCollection.updateOne(query, {
      $set: { orderStatus: "cancelled" }
    });

    await productsCollection.updateOne(
      { _id: new ObjectId(order.productId) },
      {
        $inc: { stock: 1 },
        $set: { status: "available" }
      }
    );

    res.send({
      success: true,
      message: "Order cancelled successfully and product restocked."
    });

  } catch (error) {
    res.status(500).send({
      message: "Failed to cancel order",
      error: error.message
    });
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

    if (email !== req.user?.email) {
      return res.status(403).send({ message: "Forbidden Access" });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const itemsWithProductDetails = await wishlistCollection.aggregate([
      { $match: { userId: user._id.toString() } },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          convertedProductId: {
            $cond: {
              if: { $eq: [{ $type: "$productId" }, "string"] },
              then: { $toObjectId: "$productId" },
              else: "$productId"
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "convertedProductId",
          foreignField: "_id",
          as: "productInfo"
        }
      },
      {
        $unwind: {
          path: "$productInfo",
          preserveNullAndEmptyArrays: true
        }
      }
    ]).toArray();

    const finalWishlist = itemsWithProductDetails.map(item => {
      const product = item.productInfo;
      return {
        _id: item._id,
        productId: item.productId,
        productTitle: product?.title || "Product Unavailable",
        productImage: product?.images?.[0] || product?.image || "https://via.placeholder.com/150",
        productPrice: product?.price || 0,
        stock: product?.stock || 0
      };
    });

    res.send(finalWishlist);

  } catch (error) {
    res.status(500).send({ message: "Failed to fetch wishlist", error: error.message });
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

    if (email !== req.user?.email) {
      return res.status(403).send({ success: false, message: "Forbidden Access" });
    }

    const payments = await ordersCollection
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
    res.status(500).send({
      success: false,
      message: "Internal server error",
      error: error.message
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


app.delete('/api/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
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
app.get('/api/admin/all/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { search, status } = req.query;

    let findQuery = {
      status: {
        $in: ["available", "pending", "rejected", "sold"]
      }
    };

    if (status && status !== 'all') {
      findQuery.status = status;
    }

    if (search) {
      findQuery.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const result = await productsCollection
      .find(findQuery)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);

  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
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
    const { search, status } = req.query;
    let matchQuery = {};

    if (status && status !== 'all') {
      matchQuery.orderStatus = status;
    }

    if (search) {
      matchQuery.$or = [
        { 'buyerInfo.name': { $regex: search, $options: 'i' } },
        { 'buyerInfo.email': { $regex: search, $options: 'i' } },
        { 'buyer.name': { $regex: search, $options: 'i' } },
        { 'buyer.email': { $regex: search, $options: 'i' } }
      ];
    }

    const pipeline = [];

    if (Object.keys(matchQuery).length > 0) {
      pipeline.push({ $match: matchQuery });
    }

    pipeline.push(
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
      }
    );

    if (search) {
      pipeline.push({
        $match: {
          'productDetails.title': { $regex: search, $options: 'i' }
        }
      });
    }

    pipeline.push({
      $sort: {
        createdAt: -1,
      },
    });

    const result = await ordersCollection.aggregate(pipeline).toArray();
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