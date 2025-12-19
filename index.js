const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");
const admin = require("firebase-admin");

// Firebase initialization
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("Firebase ENV loaded:", !!process.env.FIREBASE_SERVICE_ACCOUNT);

function generateTrackingId() {
  const prefix = "BC";
  const now = new Date();
  const date =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${date}-${randomHex}`;
}

// Middleware
const app = express();
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send({ message: "Unauthorized access" });
  try {
    const idToken = token.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.decodedEmail = decodedToken.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

// MongoDB connection
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("booksCourierDB");
    const usersCollection = db.collection("users");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const paymentsCollection = db.collection("payments");
    const sellersCollection = db.collection("sellers");
    const reviewsCollection = db.collection("reviews");
    const wishlistCollection = db.collection("wishlist");

    console.log("Connected to MongoDB");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedEmail; // fixed mismatch
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "admin")
        return res.status(403).send({ message: "Forbidden access" });
      next();
    };

    // Users routes
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const userExists = await usersCollection.findOne({ email: user.email });
      if (userExists)
        return res.send({ exists: true, user: `userExists-${userExists}` });
      user.role = "user";
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {
      const id = req.params.id;
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      res.send(user);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.patch("/users/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const updatedUser = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedUser }
      );
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    // Books routes
    app.post("/books", async (req, res) => {
      const book = req.body;
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    // app.get("/books", async (req, res) => {
    //   const seller_email = req.query.seller_email;
    //   const query = {};
    //   if (seller_email) query.seller_email = seller_email;
    //   const books = await booksCollection
    //     .find(query)
    //     .sort({ createdAt: -1 })
    //     .toArray();
    //   res.send(books);
    // });

    // ✅ USER – only published books
    // app.get("/books", async (req, res) => {
    //   const books = await booksCollection
    //     .find({ status: "published" }) // 🔐 force published
    //     .sort({ createdAt: -1 })
    //     .toArray();

    //   res.send(books);
    // });

    app.get("/books", async (req, res) => {
      try {
        const { search = "", sort = "", page = 1, limit = 8 } = req.query;

        // Search condition
        const query = {
          status: "published",
          title: { $regex: search, $options: "i" }, // case-insensitive search
        };

        // Sort condition
        let sortQuery = { createdAt: -1 }; // default (newest)

        if (sort === "low") sortQuery = { price: 1 };
        if (sort === "high") sortQuery = { price: -1 };

        const skip = (page - 1) * limit;

        const books = await booksCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(Number(limit))
          .toArray();

        const total = await booksCollection.countDocuments(query);

        res.send({
          total,
          page: Number(page),
          limit: Number(limit),
          books,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load books" });
      }
    });

    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const book = await booksCollection.findOne({ _id: new ObjectId(id) });
      res.send(book);
    });

    app.patch("/books/:id", async (req, res) => {
      const id = req.params.id;
      const updatedBook = req.body;
      const result = await booksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedBook }
      );
      res.send(result);
    });

    app.delete("/books/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/dashboard/books", async (req, res) => {
      const { seller_email } = req.query;
      const query = {};
      if (seller_email) query.seller_email = seller_email;
      const books = await booksCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(books);
    });

    app.patch("/admin/books/:id/status", async (req, res) => {
      const { status } = req.body;
      const id = req.params.id;

      const result = await booksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });

    app.delete("/admin/books/:id", async (req, res) => {
      const id = req.params.id;

      // delete book
      const bookDelete = await booksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      // delete all orders of this book
      const orderDelete = await ordersCollection.deleteMany({
        bookId: id,
      });

      res.send({
        bookDeleted: bookDelete.deletedCount,
        ordersDeleted: orderDelete.deletedCount,
      });
    });

    // Orders routes
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });

    app.get("/orders", verifyFBToken, async (req, res) => {
      const user_email = req.query.user_email;
      const query = {};
      if (user_email) {
        query.user_email = user_email;
        if (req.decodedEmail !== user_email)
          return res.status(403).send({ message: "Forbidden access" });
      }
      const orders = await ordersCollection
        .find(query)
        .sort({ orderDate: -1 })
        .toArray();
      res.send(orders);
    });

    app.get("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
      res.send(order);
    });

    app.patch("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const updatedOrder = req.body;
      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedOrder }
      );
      res.send(result);
    });

    app.delete("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const result = await ordersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Seller Orders
    app.get("/seller-orders", async (req, res) => {
      const { search, status } = req.query;
      const query = { status: { $ne: "cancelled" } };
      if (status && status !== "all") query.status = status;
      if (search) {
        query.$or = [
          { productName: { $regex: search, $options: "i" } },
          { customerEmail: { $regex: search, $options: "i" } },
          { orderId: { $regex: search, $options: "i" } },
        ];
      }
      const orders = await ordersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(orders);
    });

    // Payments
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        if (req.decodedEmail !== email)
          return res.status(403).send({ message: "Forbidden access" });
      }
      const payments = await paymentsCollection
        .find(query)
        .sort({ paymentDate: -1 })
        .toArray();
      res.send(payments);
    });

    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: `Order Payment for this book: ${paymentInfo.bookTitle}`,
              },
              unit_amount: paymentInfo.amount * 100,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.customer_email,
        mode: "payment",
        metadata: {
          orderId: paymentInfo.orderId,
          bookTitle: paymentInfo.bookTitle,
          booksId: paymentInfo.booksId,
          customer_phone: paymentInfo.customer_phone,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;

      const existingPayment = await paymentsCollection.findOne({
        transactionId,
      });
      if (existingPayment) {
        return res.send({
          success: true,
          message: "Payment already recorded",
          trackingId: existingPayment.trackingId,
          transactionId,
        });
      }

      if (session.payment_status === "paid") {
        const trackingId = generateTrackingId();
        await ordersCollection.updateOne(
          { _id: new ObjectId(session.metadata.orderId) },
          { $set: { paymentStatus: "paid", trackingId } }
        );
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          customerPhone: session.metadata.customer_phone,
          orderId: session.metadata.orderId,
          booksId: session.metadata.booksId,
          bookTitle: session.metadata.bookTitle,
          transactionId,
          paymentStatus: session.payment_status,
          trackingId,
          paymentDate: new Date(),
        };
        const paymentResult = await paymentsCollection.insertOne(payment);
        res.send({
          success: true,
          trackingId,
          transactionId,
          paymentInfo: paymentResult,
        });
      } else {
        res.status(400).send({ message: "Payment not completed" });
      }
    });

    // Sellers
    app.get("/sellers", verifyFBToken, async (req, res) => {
      const query = {};
      if (req.query.status) query.status = req.query.status;
      if (req.query.email) query.email = req.query.email;
      const sellers = await sellersCollection.find(query).toArray();
      res.send(sellers);
    });

    app.post("/sellers", async (req, res) => {
      const seller = req.body;
      seller.createdAt = new Date();
      seller.status = "pending";
      const result = await sellersCollection.insertOne(seller);
      res.send(result);
    });

    app.patch("/sellers/:id", async (req, res) => {
      const id = req.params.id;
      const updatedSeller = req.body;
      const result = await sellersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedSeller }
      );
      if (updatedSeller.status === "approved") {
        await usersCollection.updateOne(
          { email: updatedSeller.email },
          { $set: { role: "seller" } }
        );
      }
      res.send(result);
    });

    app.post("/wishlist", async (req, res) => {
      const wishlist = req.body;

      const exists = await wishlistCollection.findOne({
        user_email: wishlist.user_email,
        bookId: wishlist.bookId,
      });

      if (exists) {
        return res.status(409).send({ message: "Already in wishlist" });
      }

      wishlist.createdAt = new Date();
      const result = await wishlistCollection.insertOne(wishlist);
      res.send(result);
    });

    app.get("/wishlist", async (req, res) => {
      const email = req.query.email;
      const result = await wishlistCollection
        .find({ user_email: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    app.delete("/wishlist", async (req, res) => {
      // const id = req.params.id;
      const { user_email, bookId } = req.body;
      // const result = await wishlistCollection.deleteOne({
      //   _id: new ObjectId(id),
      // });
      const result = await wishlistCollection.deleteOne({
        user_email,
        bookId,
      });
      res.send(result);
    });
  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server Running Successfully 🎉");
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));

module.exports = app;
