import mongoose from "mongoose";

const FollowSchema = new mongoose.Schema(
  {
    followerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    traderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    active: { type: Boolean, default: true },
    /** proportional: scale follower order size by equity ratio vs trader */
    scalingMode: { type: String, enum: ["proportional", "fixed"], default: "proportional" },
  },
  { timestamps: true }
);

FollowSchema.index({ followerId: 1, traderId: 1 }, { unique: true });

export default mongoose.models.Follow || mongoose.model("Follow", FollowSchema);
