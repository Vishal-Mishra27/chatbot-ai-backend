import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/", async (req, res) => {
  const { lat, lng, userId = null, keyword = null } = req.query;

  if (!lat || !lng) return res.status(400).json({ error: "lat and lng are required" });

  try {
    const { data } = await axios.get("https://root.roombookkro.com/api/search", {
      params: { lat, lng, userId },
    });

    const hotels = (data.data || []).map((hotel) => ({
      residencyId: hotel.residencyId,
      name: hotel.name,
      type: hotel.type,
      address: hotel.address,
      distance: hotel.distance,
      rating: hotel.rating,
      discount: hotel.discount,
      image: hotel.photos?.[0] || null,
      rooms: (hotel.rooms || []).map((room) => ({
        roomId: room.roomId,
        roomType: room.roomType,
        pricePerNight: room.roomPricePerDay,
        amenities: room.amenities || [],
        available: room.isAvailable,
      })),
    }));

    res.json({ hotels });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Hotel search failed. Please try again." });
  }
});

export default router;
