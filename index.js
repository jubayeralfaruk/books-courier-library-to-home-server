const express = require("express");
const cors = require("cors");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  CursorTimeoutMode,
} = require("mongodb");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // Add in .env file

const app = express();
const port = process.env.PORT || 5000;

const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./books-courier-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "BC";

  // Format date: YYYYMMDD
  const now = new Date();
  const date =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  // Generate strong random hex string (4 bytes → 8 chars)
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `${prefix}-${date}-${randomHex}`;
}

// Middleware
app.use(cors());
app.use(express.json());

// const verifyFBToken = async (req, res, next) => {
//   const token = req.headers.authorization;
//   if (!token) {
//     return res.status(401).send({ message: "Unauthorized access" });
//   }

//   try {
//     const idToken = token.split(" ")[1];
//     const decodedToken = admin.auth().verifyIdToken(idToken);
//     req.decodedEmail = decodedToken.email;
//     next();
//     console.log("decoded in the token.", decodedToken);
//   } catch (error) {
//     return res.status(401).send({ message: "Unauthorized access" });
//   }
// };

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.decodedEmail = decodedToken.email;

    console.log("decoded token:", decodedToken.email);
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

// MongoDB connection
const uri = process.env.MONGO_URI; // Add in .env file

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
    const reviewsCollection = db.collection("reviews");
    const sellersCollection = db.collection("sellers");

    console.log("Connected to MongoDB");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // user data routes
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
      if (userExists) {
        return res.send({ exists: true, user: `userExists-${userExists}` });
      }
      user.role = "user"; // default role
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users/:id", async (req, res) => {
      const id = req.params.id;
      const users = await usersCollection.findOne({ _id: new ObjectId(id) });
      res.send(users);
    });
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const users = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(users);
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
      res.send({
        role: user?.role || "user",
      });
    });

    app.post("/books", async (req, res) => {
      const book = req.body;

      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    app.get("/books", async (req, res) => {
      const seller_email = req.query.seller_email;
      const query = {};
      if (seller_email) {
        query.seller_email = seller_email;
      }
      const books = await booksCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(books);
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

    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });
    app.get("/orders", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const options = { sort: { orderDate: -1 } };
      const orders = await ordersCollection.find(query, options).toArray();
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

    // seller orders (search + status filter)
    app.get("/seller-orders", async (req, res) => {
      const { search, status } = req.query;
      const query = {};

      // ❌ canceled order hide
      query.status = { $ne: "cancelled" };

      // status filter
      if (status && status !== "all") {
        query.status = status;
      }

      // search filter
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

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        // checking email from decoded token
        if (req.decodedEmail !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
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

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const existingPayment = await paymentsCollection.findOne(query);
      if (existingPayment) {
        return res.send({
          success: true,
          message: "Payment already recorded",
          trackingId: existingPayment.trackingId,
          transactionId,
        });
      }

      const trackingId = generateTrackingId();

      if (session.payment_status === "paid") {
        const orderId = session.metadata.orderId;
        const query = { _id: new ObjectId(orderId) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await ordersCollection.updateOne(query, updateDoc);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          customerPhone: session.metadata.customer_phone,
          orderId: session.metadata.orderId,
          booksId: session.metadata.booksId,
          bookTitle: session.metadata.bookTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          trackingId: trackingId,
          paymentDate: new Date(),
        };

        if (session.payment_status === "paid") {
          const paymentResult = await paymentsCollection.insertOne(payment);
          console.log("Payment record inserted:", paymentResult);

          res.send({
            success: true,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            modifyBookResult: result,
            paymentInfo: paymentResult,
          });
        }
      } else {
        res.status(400).send({ message: "Payment not completed" });
      }
    });

    app.get("/sellers", verifyFBToken, async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      if (req.query.email) {
        query.email = req.query.email;
      }
      const sellers = await sellersCollection.find(query).toArray();
      res.send(sellers);
    });
    app.post("/sellers", async (req, res) => {
      const seller = req.body;
      seller.createdAt = new Date();
      seller.status = "pending"; // default status
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
        const email = updatedSeller.email;
        const user = await usersCollection.updateOne(
          { email: email },
          { $set: { role: "seller" } }
        );
      }
      res.send(result);
    });
  } catch (error) {
    console.error(error);
  }
}
run().catch(console.dir);

// Sample GET route
app.get("/", (req, res) => {
  res.send("Server Running Successfully 🎉");
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
