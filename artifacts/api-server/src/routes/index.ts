import { Router, type IRouter } from "express";
import footballRouter from "./football";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(footballRouter);

export default router;
