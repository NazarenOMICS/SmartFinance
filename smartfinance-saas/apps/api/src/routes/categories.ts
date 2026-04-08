import { Hono } from "hono";
import { createCategoryInputSchema, updateCategoryInputSchema } from "@smartfinance/contracts";
import { createCategory, deleteCategory, listCategories, updateCategory } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const categoriesRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

categoriesRouter.get("/", async (c) => {
  const auth = c.get("auth");
  return c.json(await listCategories(c.env.DB, auth.userId));
});

categoriesRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createCategoryInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid category payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const category = await createCategory(c.env.DB, auth.userId, body.data);
    return c.json(category, 201);
  } catch {
    return jsonError("Category already exists", "CATEGORY_CONFLICT", requestId, 409);
  }
});

categoriesRouter.put("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const categoryId = Number(c.req.param("id"));
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    return jsonError("Invalid category id", "VALIDATION_ERROR", requestId, 400);
  }

  const body = updateCategoryInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid category payload", "VALIDATION_ERROR", requestId, 400);
  }

  const category = await updateCategory(c.env.DB, auth.userId, categoryId, body.data);
  if (!category) {
    return jsonError("Category not found", "CATEGORY_NOT_FOUND", requestId, 404);
  }

  return c.json(category);
});

categoriesRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const categoryId = Number(c.req.param("id"));
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    return jsonError("Invalid category id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await deleteCategory(c.env.DB, auth.userId, categoryId);
  if (!result.deleted) {
    return jsonError("Category cannot be deleted yet", result.reason, requestId, 409);
  }

  return new Response(null, { status: 204 });
});

export default categoriesRouter;

