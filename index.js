const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.PAYMENT_INTENT_SECRET);
console.log("payment intext key", process.env.PAYMENT_INTENT_SECRET);
const port = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xvizize.mongodb.net/?retryWrites=true&w=majority`;

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
        // await client.connect();


        const menuCollection = client.db("bistroDb_2").collection("menu");
        const userCollection = client.db("bistroDb_2").collection("user");
        const reviewCollection = client.db("bistroDb_2").collection("reviews");
        const cartCollection = client.db("bistroDb_2").collection("carts");
        const paymentCollection = client.db("bistroDb_2").collection("payments");


        //* ========= Token Related APIs ===========*\\

        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
            res.send({ token })
        })

        //* JWT Middleware
        const veryfyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: "Unauthorized access!" });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "Unauthorized access!" });
                }
                req.decoded = decoded;
                next();
            })
        }

        const veryfyAdmin = async (req, res, next) => {
            const email = req.decoded?.email;
            // console.log("decoded email", email);
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === "admin";
            if (!isAdmin) {
                return res.status(403).send({ message: "Forbidden access" });
            }
            next();
        }

        //* ========= Users Collection Start ===========*\\

        //? Create user Methods
        app.post("/user", async (req, res) => {
            const userInfo = req.body;

            const query = { email: userInfo?.email };
            const isExist = await userCollection.findOne(query);
            if (isExist) {
                return res.send({ message: "User already exist!", insertedId: null })
            }
            const result = await userCollection.insertOne(userInfo);
            res.send({ result, message: "User created successfully" });
        })

        //? Get All users 
        app.get("/user", veryfyToken, veryfyAdmin, async (req, res) => {
            const allUsers = await userCollection.find().toArray();
            res.send(allUsers);
        })

        //?Get Admin User 
        app.get("/user/admin/:email", veryfyToken, async (req, res) => {
            const email = req.params?.email;
            // console.log("admin route email", email);
            if (email !== req?.decoded?.email) {
                return res.status(403).send({ message: "Forbidden access!" });
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === "admin";
            }
            res.send({ admin });
        })

        //? Delete User by Id
        app.delete("/user/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        //? Update user role from admin
        app.patch("/user/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        })

        //* ========= Menu Related API's Start ===========*\\
        //* Get all menus
        app.get("/menu", async (req, res) => {
            const menu = await menuCollection.find().toArray();
            res.send(menu)
        });

        //? Post a menu
        app.post("/menu", veryfyToken, veryfyAdmin, async (req, res) => {
            const menuItem = req.body;
            const result = await menuCollection.insertOne(menuItem);
            res.send(result);
        })

        //?Delete menu 
        app.delete("/menu/:id", veryfyToken, veryfyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })

        //? Update Menu
        app.patch("/menu/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body; // Assuming you're sending the update data in the request body
                const query = { _id: new ObjectId(id) };
                const result = await menuCollection.updateOne(query, { $set: updateData });
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: 'An error occurred while updating the item.' });
            }
        });

        //* Get all reviews
        app.get("/review", async (req, res) => {
            const menu = await reviewCollection.find().toArray();
            res.send(menu)
        });

        //* add to cart 
        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const isExist = await cartCollection.findOne(cartItem);
            if (isExist) {
                return res.send({ success: false, message: "This Item already added your cart!" })
            } else {
                await cartCollection.insertOne(cartItem);
                return res.send({ success: true, message: "Item added successfully!" })
            }
        });

        //* get cartItems by email
        app.get("/carts", async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })

        //* Delete user cart by Id 
        app.delete("/cart/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        //* Payment Intent api
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            // console.log("amount inside the intent", amount);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            })

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post("/payments", async (req, res) => {
            const paymentInfo = req.body;
            const paymentResult = await paymentCollection.insertOne(paymentInfo);

            const query = {
                _id: {
                    $in: paymentInfo.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteCartId = await cartCollection.deleteMany(query)
            res.send({ paymentResult, deleteCartId })
        });

        //* Get specific user payment history
        app.get("/payments/:email", async (req, res) => {
            const query = { email: req.params.email };
            // if (req.params.email !== req.decoded.email) {
            //     return res.status(403).send({ message: "Forbidden access" })
            // }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        //* Admin Stats 
        app.get("/admin-stats", veryfyToken, veryfyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const items = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalPrice: { $sum: "$price" }
                    }
                }
            ]).toArray();

            const revinue = result.length > 0 ? result[0].totalPrice : 0;
            res.send({
                users,
                items,
                orders,
                revinue
            })
        });

        //* Agregate order pipeline
        app.get("/order-stats", async (req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: "$menuItemIds"
                },
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: "$menuItems"
                },
                {
                    $group: {
                        _id: "$menuItems.category",
                        quantity: { $sum: 1 },
                        revenue: { $sum: "$menuItems.price" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: "$_id",
                        quantity: "$quantity",
                        revenue: "$revenue"
                    }
                }
            ]).toArray();

            res.send(result);
        })



        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("bistro-boss server is running");
});



app.listen(port, () => {
    console.log(`Bistor-boss server is running on ${port}`);
})
