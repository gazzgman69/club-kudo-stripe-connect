import { Router, type IRouter } from "express";
import healthRouter from "./health";
import csrfRouter from "./csrf";

const router: IRouter = Router();

router.use(healthRouter);
router.use(csrfRouter);

export default router;
