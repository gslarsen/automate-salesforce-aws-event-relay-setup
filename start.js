import express from "express";
import axios from "axios";
import querystring from "querystring";
import dotenv from "dotenv";
import { refreshSalesforce } from "./refreshSalesforce.js";

dotenv.config();

const app = express();
const port = 3000;

// OAuth 2.0 Authorization Code Flow
let access_token = "";
let refresh_token = "";

const token_params = {
  grant_type: "authorization_code",
  client_id: `${process.env.CLIENT_ID}`,
  client_secret: `${process.env.CLIENT_SECRET}`,
  redirect_uri: `${process.env.REDIRECT_URI}`,
};

app.get("/login", (req, res) => {
  const params = {
    response_type: "code",
    client_id: `${process.env.CLIENT_ID}`,
    redirect_uri: `${process.env.REDIRECT_URI}`,
    scope: "refresh_token api id",
  };

  const authUrl = `${process.env.AUTH_TOKEN_ENDPOINT}?${querystring.stringify(
    params
  )}`;

  res.redirect(authUrl);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    console.error(
      `No authorization code in the request - try authenticating again: http://localhost:${port}/login`
    );
    return res.status(400).send("Authorization code not found in the request");
  }

  console.log("\nBegin OAuth 2.0 exchange with Salesforce for access token...");

  try {
    const tokenResponse = await axios.post(
      `${process.env.ACCESS_TOKEN_ENDPOINT}`,
      querystring.stringify({ ...token_params, code })
    );

    access_token = tokenResponse.data.access_token;
    refresh_token = tokenResponse.data.refresh_token;
    console.log("Success - access token and refresh token received");

    res.send(
      "Successfully authenticated with Salesforce. Please close this window and return to the terminal."
    );
    refreshSalesforce(access_token, refresh_token);
  } catch (error) {
    console.error("Error retrieving access token:", error);
    return res.status(500).send("Error retrieving access token");
  }
});

app.listen(port, () => {
  console.log(
    `Server is running on port ${port}`,
    `\nAUTHENTICATE HERE: http://localhost:${port}/login`
  );
});
