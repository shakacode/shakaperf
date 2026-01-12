# Product seed data
products = [
  {
    name: "Wireless Bluetooth Headphones",
    price: 79.99,
    description: "Premium wireless headphones with active noise cancellation and 30-hour battery life.",
    image_url: "https://picsum.photos/seed/headphones/400/400",
    category: "Electronics",
    featured: true,
    stock: 50
  },
  {
    name: "Organic Cotton T-Shirt",
    price: 29.99,
    description: "Soft and comfortable organic cotton t-shirt available in multiple colors.",
    image_url: "https://picsum.photos/seed/tshirt/400/400",
    category: "Clothing",
    featured: false,
    stock: 100
  },
  {
    name: "Stainless Steel Water Bottle",
    price: 24.99,
    description: "Insulated water bottle that keeps drinks cold for 24 hours or hot for 12 hours.",
    image_url: "https://picsum.photos/seed/bottle/400/400",
    category: "Home",
    featured: true,
    stock: 75
  },
  {
    name: "Mechanical Keyboard",
    price: 149.99,
    description: "RGB mechanical keyboard with Cherry MX switches and programmable keys.",
    image_url: "https://picsum.photos/seed/keyboard/400/400",
    category: "Electronics",
    featured: true,
    stock: 30
  },
  {
    name: "Running Shoes",
    price: 119.99,
    description: "Lightweight running shoes with responsive cushioning and breathable mesh.",
    image_url: "https://picsum.photos/seed/shoes/400/400",
    category: "Sports",
    featured: false,
    stock: 60
  },
  {
    name: "Leather Wallet",
    price: 49.99,
    description: "Genuine leather bifold wallet with RFID blocking technology.",
    image_url: "https://picsum.photos/seed/wallet/400/400",
    category: "Accessories",
    featured: false,
    stock: 80
  },
  {
    name: "Smart Watch",
    price: 299.99,
    description: "Feature-rich smartwatch with health monitoring and GPS tracking.",
    image_url: "https://picsum.photos/seed/watch/400/400",
    category: "Electronics",
    featured: true,
    stock: 25
  },
  {
    name: "Yoga Mat",
    price: 34.99,
    description: "Non-slip yoga mat with extra cushioning for comfort during workouts.",
    image_url: "https://picsum.photos/seed/yogamat/400/400",
    category: "Sports",
    featured: false,
    stock: 90
  },
  {
    name: "Backpack",
    price: 69.99,
    description: "Durable backpack with laptop compartment and multiple pockets.",
    image_url: "https://picsum.photos/seed/backpack/400/400",
    category: "Accessories",
    featured: true,
    stock: 45
  },
  {
    name: "Coffee Maker",
    price: 89.99,
    description: "Programmable coffee maker with thermal carafe and auto-shutoff.",
    image_url: "https://picsum.photos/seed/coffee/400/400",
    category: "Home",
    featured: false,
    stock: 35
  }
]

products.each do |product_attrs|
  Product.find_or_create_by!(name: product_attrs[:name]) do |product|
    product.assign_attributes(product_attrs)
  end
end

puts "Created #{Product.count} products"
