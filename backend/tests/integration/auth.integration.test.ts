import "dotenv/config";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { StoreMembershipModel } from "../../src/models/store-membership";
import { StoreModel } from "../../src/models/store";
import { UserModel } from "../../src/models/user";
import { ProductModel } from "../../src/models/product";

const TEST_DATABASE = "stockly_test";
const FRONTEND_ORIGIN = "http://localhost:3000";
const app = createApp({
  nodeEnv: "test",
  sessionSecret: "integration-session-secret-long-enough",
  sessionMongoUrl: getTestUri(),
  corsOrigins: [FRONTEND_ORIGIN],
});
const ownedEmails: string[] = [];
const ownedStoreIds: Types.ObjectId[] = [];
const ownedUserIds: Types.ObjectId[] = [];

function getTestUri(): string {
  const raw = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI;
  if (!raw) throw new Error("Set MONGODB_TEST_URI for authentication integration tests.");
  const uri = new URL(raw);
  if (
    uri.protocol !== "mongodb:" ||
    ![TEST_DATABASE, "stockly"].includes(decodeURIComponent(uri.pathname.slice(1))) ||
    !["localhost", "127.0.0.1", "::1"].includes(uri.hostname.replace(/^\[|\]$/g, "").toLowerCase())
  ) {
    throw new Error("Authentication integration tests require a local MongoDB source URI.");
  }
  if (process.env.MONGODB_TEST_URI && decodeURIComponent(uri.pathname.slice(1)) !== TEST_DATABASE) {
    throw new Error("MONGODB_TEST_URI must target only stockly_test.");
  }
  if (uri.searchParams.get("replicaSet") !== "rs0") throw new Error("Authentication integration tests require replicaSet=rs0.");
  if (!process.env.MONGODB_TEST_URI) uri.pathname = `/${TEST_DATABASE}`;
  return uri.toString();
}

function origin(requestBuilder: request.Test): request.Test {
  return requestBuilder.set("Origin", FRONTEND_ORIGIN);
}

describe("authentication and store membership on local MongoDB rs0", () => {
  beforeAll(async () => {
    await mongoose.connect(getTestUri(), { serverSelectionTimeoutMS: 5_000 });
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (
      mongoose.connection.db!.databaseName !== TEST_DATABASE ||
      hello.setName !== "rs0" ||
      hello.isWritablePrimary !== true ||
      hello.msg === "isdbgrid"
    ) {
      await mongoose.disconnect();
      throw new Error("Refusing authentication integration tests outside a writable local stockly_test rs0 database.");
    }
    await UserModel.createIndexes();
    await StoreMembershipModel.createIndexes();
  });

  afterAll(async () => {
    if (ownedUserIds.length > 0) {
      await mongoose.connection.db!.collection("sessions").deleteMany({
        "session.userId": { $in: ownedUserIds.map((id) => id.toString()) },
      });
      await StoreMembershipModel.deleteMany({ user: { $in: ownedUserIds } });
      await UserModel.deleteMany({ _id: { $in: ownedUserIds } });
    }
    if (ownedStoreIds.length > 0) {
      await ProductModel.deleteMany({ store: { $in: ownedStoreIds } });
      await StoreMembershipModel.deleteMany({ store: { $in: ownedStoreIds } });
      await StoreModel.deleteMany({ _id: { $in: ownedStoreIds } });
    }
    await app.locals.sessionStore?.close();
    await mongoose.disconnect();
  });

  it("registers, rotates sessions on login, creates owned stores, and enforces membership", async () => {
    const email = `auth-${new Types.ObjectId().toHexString()}@example.test`;
    const ownerAgent = request.agent(app);
    const registerResponse = await origin(ownerAgent.post("/api/auth/register")).send({
      name: "Store Owner",
      email: email.toUpperCase(),
      password: "correct-horse-battery-1",
    });
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.data.user.email).toBe(email);
    expect(registerResponse.body.data.user).not.toHaveProperty("passwordHash");
    expect(registerResponse.body.data.csrfToken).toBeTruthy();
    expect(registerResponse.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    expect(registerResponse.headers["set-cookie"][0]).toMatch(/SameSite=Lax/i);
    const originalCookie = registerResponse.headers["set-cookie"][0].split(";")[0];
    const owner = await UserModel.findOne({ email });
    expect(owner).not.toBeNull();
    expect(owner!.passwordHash).not.toBe("correct-horse-battery-1");
    ownedEmails.push(email);
    ownedUserIds.push(owner!._id);

    const duplicate = await origin(request(app).post("/api/auth/register")).send({
      name: "Another Name",
      email,
      password: "correct-horse-battery-2",
    });
    expect(duplicate.status).toBe(409);

    const invalidLogin = await origin(request(app).post("/api/auth/login")).send({
      email: "unknown@example.test",
      password: "correct-horse-battery-1",
    });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(invalidLogin.body.error.message).toBe("Email or password is incorrect.");

    const loginResponse = await origin(ownerAgent.post("/api/auth/login"))
      .set("X-CSRF-Token", registerResponse.body.data.csrfToken)
      .send({ email, password: "correct-horse-battery-1" });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers["set-cookie"][0].split(";")[0]).not.toBe(originalCookie);
    const csrfToken = loginResponse.body.data.csrfToken as string;
    expect((await ownerAgent.get("/api/stores/current")).body.data).toBeNull();

    const blockedWithoutCsrf = await origin(ownerAgent.post("/api/stores")).send({
      name: "Not Allowed",
      address: "No token",
      timezone: "UTC",
      currency: "USD",
    });
    expect(blockedWithoutCsrf.status).toBe(403);
    expect(blockedWithoutCsrf.body.error.code).toBe("CSRF_VALIDATION_FAILED");

    const firstStoreResponse = await origin(ownerAgent.post("/api/stores"))
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Owner Store One", address: "Address one", timezone: "UTC", currency: "USD" });
    expect(firstStoreResponse.status).toBe(201);
    const firstStoreId = firstStoreResponse.body.data.id as string;
    ownedStoreIds.push(new Types.ObjectId(firstStoreId));
    expect(firstStoreResponse.body.data.role).toBe("OWNER");
    expect(await StoreMembershipModel.findOne({ user: owner!._id, store: firstStoreId, role: "OWNER" })).not.toBeNull();

    const secondStoreResponse = await origin(ownerAgent.post("/api/stores"))
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Owner Store Two", address: "Address two", timezone: "UTC", currency: "USD" });
    expect(secondStoreResponse.status).toBe(201);
    const secondStoreId = secondStoreResponse.body.data.id as string;
    ownedStoreIds.push(new Types.ObjectId(secondStoreId));
    const listedStores = await ownerAgent.get("/api/stores");
    expect(listedStores.status).toBe(200);
    expect(listedStores.body.data.map((store: { id: string }) => store.id)).toEqual(
      expect.arrayContaining([firstStoreId, secondStoreId]),
    );

    const firstProduct = await ProductModel.create({
      store: new Types.ObjectId(firstStoreId),
      name: "First store product",
      sku: `FIRST-${new Types.ObjectId().toHexString()}`,
      category: "Grocery",
      baseUnit: "each",
      sellingPrice: Types.Decimal128.fromString("1.00"),
      isActive: true,
    });
    const secondProduct = await ProductModel.create({
      store: new Types.ObjectId(secondStoreId),
      name: "Second store product",
      sku: `SECOND-${new Types.ObjectId().toHexString()}`,
      category: "Grocery",
      baseUnit: "each",
      sellingPrice: Types.Decimal128.fromString("2.00"),
      isActive: true,
    });
    await ownerAgent.post("/api/stores/current")
      .set("Origin", FRONTEND_ORIGIN)
      .set("X-CSRF-Token", csrfToken)
      .send({ storeId: firstStoreId })
      .expect(200);

    const scopedList = await ownerAgent.get("/api/products").set("X-Store-Id", secondStoreId);
    expect(scopedList.status).toBe(200);
    expect(scopedList.body.data.map((product: { _id: string }) => product._id)).toContain(firstProduct._id.toString());
    expect(scopedList.body.data.map((product: { _id: string }) => product._id)).not.toContain(secondProduct._id.toString());
    const crossStoreObject = await ownerAgent.get(`/api/products/${secondProduct._id.toString()}`);
    expect(crossStoreObject.status).toBe(404);
    const crossStoreUpdate = await ownerAgent.patch(`/api/products/${secondProduct._id.toString()}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "Unauthorized update" });
    expect(crossStoreUpdate.status).toBe(404);
    expect((await ProductModel.findById(secondProduct._id))?.name).toBe("Second store product");

    const outsiderEmail = `outsider-${new Types.ObjectId().toHexString()}@example.test`;
    const outsiderAgent = request.agent(app);
    const outsiderResponse = await origin(outsiderAgent.post("/api/auth/register")).send({
      name: "Other owner",
      email: outsiderEmail,
      password: "correct-horse-battery-3",
    });
    expect(outsiderResponse.status).toBe(201);
    const outsider = await UserModel.findOne({ email: outsiderEmail });
    ownedEmails.push(outsiderEmail);
    ownedUserIds.push(outsider!._id);
    const outsiderStore = await origin(outsiderAgent.post("/api/stores"))
      .set("X-CSRF-Token", outsiderResponse.body.data.csrfToken)
      .send({ name: "Other store", address: "Other address", timezone: "UTC", currency: "USD" });
    expect(outsiderStore.status).toBe(201);
    ownedStoreIds.push(new Types.ObjectId(outsiderStore.body.data.id));
    const unauthorizedSwitch = await origin(ownerAgent.post("/api/stores/current"))
      .set("X-CSRF-Token", csrfToken)
      .send({ storeId: outsiderStore.body.data.id });
    expect(unauthorizedSwitch.status).toBe(403);

    await ownerAgent.post("/api/auth/logout")
      .set("Origin", FRONTEND_ORIGIN)
      .set("X-CSRF-Token", csrfToken)
      .expect(204);
    expect((await ownerAgent.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects every protected business route without a session", async () => {
    const validObjectId = new Types.ObjectId().toString();
    const protectedRequests = [
      request(app).get("/api/products"),
      request(app).post("/api/products").send({}),
      request(app).get(`/api/products/${validObjectId}`),
      request(app).patch(`/api/products/${validObjectId}`).send({}),
      request(app).delete(`/api/products/${validObjectId}`),
      request(app).get("/api/inventory"),
      request(app).get(`/api/inventory/${validObjectId}`),
      request(app).post(`/api/inventory/${validObjectId}/batches`).send({}),
      request(app).get(`/api/inventory/${validObjectId}/batches`),
      request(app).post("/api/sales").send({}),
      request(app).get("/api/sales"),
      request(app).get("/api/alerts"),
      request(app).post("/api/alerts/run-check").send({}),
      request(app).patch(`/api/alerts/${validObjectId}/acknowledge`).send({}),
      request(app).patch(`/api/alerts/${validObjectId}/resolve`).send({}),
      request(app).get("/api/demand/history?startDate=2026-01-01&endDate=2026-01-02"),
      request(app).post("/api/forecasts").send({}),
      request(app).get("/api/restocking/recommendations"),
    ];

    const responses = await Promise.all(protectedRequests);
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: protectedRequests.length }, () => 401),
    );
    expect(responses.every((response) => response.body.error.code === "AUTHENTICATION_REQUIRED")).toBe(true);
  });

  it("rejects disabled accounts and revoked store memberships", async () => {
    const disabledEmail = `disabled-${new Types.ObjectId().toHexString()}@example.test`;
    const disabledAgent = request.agent(app);
    const disabledRegistration = await origin(disabledAgent.post("/api/auth/register")).send({
      name: "Disabled account",
      email: disabledEmail,
      password: "correct-horse-battery-4",
    });
    const disabledUser = await UserModel.findOne({ email: disabledEmail });
    ownedEmails.push(disabledEmail);
    ownedUserIds.push(disabledUser!._id);
    const disabledStore = await origin(disabledAgent.post("/api/stores"))
      .set("X-CSRF-Token", disabledRegistration.body.data.csrfToken)
      .send({ name: "Disabled account store", address: "Address", timezone: "UTC", currency: "USD" });
    ownedStoreIds.push(new Types.ObjectId(disabledStore.body.data.id));
    await UserModel.updateOne({ _id: disabledUser!._id }, { status: "disabled" });

    const disabledResponse = await disabledAgent.get("/api/products");
    expect(disabledResponse.status).toBe(401);
    expect(disabledResponse.body.error.code).toBe("AUTHENTICATION_REQUIRED");

    const revokedEmail = `revoked-${new Types.ObjectId().toHexString()}@example.test`;
    const revokedAgent = request.agent(app);
    const revokedRegistration = await origin(revokedAgent.post("/api/auth/register")).send({
      name: "Revoked member",
      email: revokedEmail,
      password: "correct-horse-battery-5",
    });
    const revokedUser = await UserModel.findOne({ email: revokedEmail });
    ownedEmails.push(revokedEmail);
    ownedUserIds.push(revokedUser!._id);
    const revokedStore = await origin(revokedAgent.post("/api/stores"))
      .set("X-CSRF-Token", revokedRegistration.body.data.csrfToken)
      .send({ name: "Revoked store", address: "Address", timezone: "UTC", currency: "USD" });
    ownedStoreIds.push(new Types.ObjectId(revokedStore.body.data.id));
    await StoreMembershipModel.updateOne(
      { user: revokedUser!._id, store: revokedStore.body.data.id },
      { status: "REVOKED" },
    );

    const revokedResponse = await revokedAgent.get("/api/products");
    expect(revokedResponse.status).toBe(403);
    expect(revokedResponse.body.error.code).toBe("STORE_ACCESS_DENIED");
  });
});
